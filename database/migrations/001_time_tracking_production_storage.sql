-- Time Tracking production storage, idempotency, and transactional write RPC.

create extension if not exists pgcrypto;

alter table public.correction_requests
  add column if not exists expected_session_version integer;

update public.correction_requests
set expected_session_version = version
where expected_session_version is null;

alter table public.correction_requests
  alter column expected_session_version set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'correction_requests_expected_session_version_positive'
      and conrelid = 'public.correction_requests'::regclass
  ) then
    alter table public.correction_requests
      add constraint correction_requests_expected_session_version_positive
        check (expected_session_version > 0);
  end if;
end;
$$;

create table if not exists public.time_tracking_idempotency (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid,
  request_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.time_tracking_idempotency
  add column if not exists membership_id uuid;

update public.time_tracking_idempotency
set membership_id = coalesce(
  nullif(result #>> '{response,session,membershipId}', '')::uuid,
  nullif(result #>> '{response,requesterMembershipId}', '')::uuid
)
where membership_id is null;

do $$
begin
  if exists (
    select 1
    from public.time_tracking_idempotency
    where membership_id is null
  ) then
    raise exception 'cannot_migrate_time_tracking_idempotency_without_membership_id';
  end if;
end;
$$;

alter table public.time_tracking_idempotency
  alter column membership_id set not null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'time_tracking_idempotency_pkey'
      and conrelid = 'public.time_tracking_idempotency'::regclass
  ) then
    alter table public.time_tracking_idempotency
      drop constraint time_tracking_idempotency_pkey;
  end if;

  alter table public.time_tracking_idempotency
    add constraint time_tracking_idempotency_pkey
      primary key (organization_id, membership_id, request_id);
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'time_tracking_idempotency_membership_fk'
      and conrelid = 'public.time_tracking_idempotency'::regclass
  ) then
    alter table public.time_tracking_idempotency
      add constraint time_tracking_idempotency_membership_fk
        foreign key (organization_id, membership_id)
        references public.memberships(organization_id, id)
        on delete cascade;
  end if;
end;
$$;

alter table public.time_tracking_idempotency enable row level security;

create index if not exists clock_events_session_recorded_idx
  on public.clock_events(organization_id, work_session_id, recorded_at);

create index if not exists work_breaks_session_started_idx
  on public.work_breaks(organization_id, work_session_id, started_at);

create index if not exists time_tracking_idempotency_created_idx
  on public.time_tracking_idempotency(organization_id, membership_id, created_at desc);

create or replace function public.prevent_time_tracking_history_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'append_only_history';
end;
$$;

drop trigger if exists clock_events_append_only on public.clock_events;
create trigger clock_events_append_only
  before update or delete on public.clock_events
  for each row execute function public.prevent_time_tracking_history_change();

drop trigger if exists audit_events_append_only on public.audit_events;
create trigger audit_events_append_only
  before update or delete on public.audit_events
  for each row execute function public.prevent_time_tracking_history_change();

create or replace function public.time_tracking_assert_period_open(
  target_organization_id uuid,
  target_membership_id uuid,
  target_work_date date,
  target_operation text
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if target_operation not in ('clock', 'correction') then
    raise exception 'invalid_state: unsupported_period_operation';
  end if;

  if not exists (
    select 1
    from public.memberships m
    where m.organization_id = target_organization_id
      and m.id = target_membership_id
      and m.status = 'active'
  ) then
    raise exception 'invalid_state: period_membership_not_active';
  end if;

  if exists (
    select 1
    from public.month_closures mc
    where mc.organization_id = target_organization_id
      and mc.membership_id = target_membership_id
      and mc.month_start = date_trunc('month', target_work_date)::date
      and mc.reopened_at is null
  ) then
    raise exception 'period_closed';
  end if;
end;
$$;

create or replace function public.time_tracking_apply_operations(operations jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  operation jsonb;
  existing_result jsonb;
  session_payload jsonb;
  break_payload jsonb;
  correction_payload jsonb;
  event_payload jsonb;
begin
  if jsonb_typeof(operations) <> 'array' then
    raise exception 'invalid_state: operations_must_be_array';
  end if;

  for operation in select value from jsonb_array_elements(operations)
  loop
    if operation->>'type' = 'save_idempotent_result' then
      select result into existing_result
      from public.time_tracking_idempotency
      where organization_id = (operation->>'organizationId')::uuid
        and membership_id = (operation->>'membershipId')::uuid
        and request_id = (operation->>'requestId')::uuid
      for update;

      if existing_result is not null then
        if existing_result = operation->'result' then
          return;
        end if;

        raise exception 'invalid_state: idempotency_key_reused';
      end if;

      if not exists (
        select 1
        from public.memberships m
        where m.organization_id = (operation->>'organizationId')::uuid
          and m.id = (operation->>'membershipId')::uuid
          and m.status = 'active'
      ) then
        raise exception 'invalid_state: idempotency_membership_not_active';
      end if;

      insert into public.time_tracking_idempotency(organization_id, membership_id, request_id, result)
      values (
        (operation->>'organizationId')::uuid,
        (operation->>'membershipId')::uuid,
        (operation->>'requestId')::uuid,
        operation->'result'
      );
    end if;
  end loop;

  for operation in select value from jsonb_array_elements(operations)
  loop
    case operation->>'type'
      when 'save_idempotent_result' then
        null;

      when 'insert_session' then
        session_payload := operation->'session';

        if not exists (
          select 1
          from public.memberships m
          where m.organization_id = (session_payload->>'organizationId')::uuid
            and m.id = (session_payload->>'membershipId')::uuid
            and m.status = 'active'
        ) then
          raise exception 'invalid_state: session_membership_not_active';
        end if;

        insert into public.work_sessions(
          id,
          organization_id,
          membership_id,
          work_date,
          started_at,
          ended_at,
          source,
          version
        )
        values (
          (session_payload->>'id')::uuid,
          (session_payload->>'organizationId')::uuid,
          (session_payload->>'membershipId')::uuid,
          (session_payload->>'workDate')::date,
          (session_payload->>'startedAt')::timestamptz,
          nullif(session_payload->>'endedAt', '')::timestamptz,
          coalesce(session_payload->>'source', 'clock')::public.work_session_source,
          coalesce((session_payload->>'version')::integer, 1)
        );

        for break_payload in select value from jsonb_array_elements(coalesce(session_payload->'breaks', '[]'::jsonb))
        loop
          insert into public.work_breaks(id, organization_id, work_session_id, started_at, ended_at)
          values (
            (break_payload->>'id')::uuid,
            (break_payload->>'organizationId')::uuid,
            (break_payload->>'workSessionId')::uuid,
            (break_payload->>'startedAt')::timestamptz,
            nullif(break_payload->>'endedAt', '')::timestamptz
          );
        end loop;

      when 'update_session' then
        session_payload := operation->'session';

        update public.work_sessions
        set work_date = (session_payload->>'workDate')::date,
            started_at = (session_payload->>'startedAt')::timestamptz,
            ended_at = nullif(session_payload->>'endedAt', '')::timestamptz,
            source = (session_payload->>'source')::public.work_session_source,
            version = (session_payload->>'version')::integer,
            updated_at = now()
        where organization_id = (session_payload->>'organizationId')::uuid
          and id = (session_payload->>'id')::uuid
          and membership_id = (session_payload->>'membershipId')::uuid;

        if not found then
          raise exception 'invalid_state: session_not_found';
        end if;

        delete from public.work_breaks
        where organization_id = (session_payload->>'organizationId')::uuid
          and work_session_id = (session_payload->>'id')::uuid;

        for break_payload in select value from jsonb_array_elements(coalesce(session_payload->'breaks', '[]'::jsonb))
        loop
          insert into public.work_breaks(id, organization_id, work_session_id, started_at, ended_at)
          values (
            (break_payload->>'id')::uuid,
            (break_payload->>'organizationId')::uuid,
            (break_payload->>'workSessionId')::uuid,
            (break_payload->>'startedAt')::timestamptz,
            nullif(break_payload->>'endedAt', '')::timestamptz
          );
        end loop;

      when 'append_clock_event' then
        event_payload := operation->'event';

        if not exists (
          select 1
          from public.work_sessions ws
          where ws.organization_id = (event_payload->>'organizationId')::uuid
            and ws.id = (event_payload->>'workSessionId')::uuid
            and ws.membership_id = (event_payload->>'membershipId')::uuid
        ) then
          raise exception 'invalid_state: clock_event_session_membership_mismatch';
        end if;

        insert into public.clock_events(
          id,
          organization_id,
          work_session_id,
          membership_id,
          event_type,
          occurred_at,
          recorded_at,
          request_id
        )
        values (
          (event_payload->>'id')::uuid,
          (event_payload->>'organizationId')::uuid,
          (event_payload->>'workSessionId')::uuid,
          (event_payload->>'membershipId')::uuid,
          (event_payload->>'eventType')::public.clock_event_type,
          (event_payload->>'occurredAt')::timestamptz,
          (event_payload->>'recordedAt')::timestamptz,
          (event_payload->>'requestId')::uuid
        );

      when 'insert_correction' then
        correction_payload := operation->'correction';

        if not exists (
          select 1
          from public.work_sessions ws
          where ws.organization_id = (correction_payload->>'organizationId')::uuid
            and ws.id = (correction_payload->>'sessionId')::uuid
            and ws.membership_id = (correction_payload->>'requesterMembershipId')::uuid
        ) then
          raise exception 'invalid_state: correction_session_membership_mismatch';
        end if;

        insert into public.correction_requests(
          id,
          organization_id,
          requester_membership_id,
          work_session_id,
          original_values,
          proposed_values,
          reason,
          status,
          created_at,
          expected_session_version
        )
        values (
          (correction_payload->>'id')::uuid,
          (correction_payload->>'organizationId')::uuid,
          (correction_payload->>'requesterMembershipId')::uuid,
          (correction_payload->>'sessionId')::uuid,
          correction_payload->'original',
          correction_payload->'proposed',
          correction_payload->>'reason',
          (correction_payload->>'status')::public.correction_status,
          (correction_payload->>'createdAt')::timestamptz,
          (correction_payload->>'expectedVersion')::integer
        );

      when 'update_correction' then
        correction_payload := operation->'correction';

        update public.correction_requests
        set status = (correction_payload->>'status')::public.correction_status,
            reviewed_by_membership_id = nullif(correction_payload->>'reviewedByMembershipId', '')::uuid,
            review_comment = nullif(correction_payload->>'reviewComment', ''),
            reviewed_at = nullif(correction_payload->>'reviewedAt', '')::timestamptz,
            version = version + 1
        where organization_id = (correction_payload->>'organizationId')::uuid
          and id = (correction_payload->>'id')::uuid
          and requester_membership_id = (correction_payload->>'requesterMembershipId')::uuid;

        if not found then
          raise exception 'invalid_state: correction_not_found';
        end if;

      when 'append_audit_event' then
        event_payload := operation->'event';

        if not exists (
          select 1
          from public.memberships m
          where m.organization_id = (event_payload->>'organizationId')::uuid
            and m.id = (event_payload->>'actorMembershipId')::uuid
            and m.user_id = (event_payload->>'actorUserId')::uuid
        ) then
          raise exception 'invalid_state: audit_actor_membership_mismatch';
        end if;

        insert into public.audit_events(
          id,
          organization_id,
          actor_user_id,
          actor_membership_id,
          action,
          entity_type,
          entity_id,
          occurred_at,
          request_id,
          before_values,
          after_values,
          metadata
        )
        values (
          (event_payload->>'id')::uuid,
          (event_payload->>'organizationId')::uuid,
          (event_payload->>'actorUserId')::uuid,
          (event_payload->>'actorMembershipId')::uuid,
          event_payload->>'action',
          event_payload->>'entityType',
          nullif(event_payload->>'entityId', '')::uuid,
          (event_payload->>'occurredAt')::timestamptz,
          nullif(event_payload->>'requestId', '')::uuid,
          event_payload->'beforeValues',
          event_payload->'afterValues',
          coalesce(event_payload->'metadata', '{}'::jsonb)
        );

      else
        raise exception 'invalid_state: unsupported_time_tracking_operation';
    end case;
  end loop;
end;
$$;
