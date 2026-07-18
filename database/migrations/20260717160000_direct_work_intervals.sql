-- Direct employee-owned work intervals. Legacy breaks/corrections remain as history only.
create extension if not exists btree_gist;

alter type public.work_session_source add value if not exists 'manual';

alter table public.work_sessions drop constraint if exists work_sessions_positive_duration;
alter table public.work_sessions add constraint work_sessions_positive_duration check (ended_at is null or ended_at > started_at);

alter table public.work_sessions drop constraint if exists work_sessions_no_overlap;
alter table public.work_sessions add constraint work_sessions_no_overlap
  exclude using gist (
    organization_id with =,
    membership_id with =,
    tstzrange(started_at, coalesce(ended_at, 'infinity'::timestamptz), '[)') with &&
  ) where (archived_at is null);

create or replace function public.time_tracking_assert_period_open(target_organization_id uuid, target_membership_id uuid, target_work_date date, target_operation text)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if target_operation not in ('clock', 'manual', 'correction') then raise exception 'invalid_state: unsupported_period_operation'; end if;
  if not exists (select 1 from public.memberships m where m.organization_id = target_organization_id and m.id = target_membership_id and m.status = 'active') then raise exception 'invalid_state: period_membership_not_active'; end if;
  if exists (select 1 from public.month_closures mc where mc.organization_id = target_organization_id and mc.membership_id = target_membership_id and mc.month_start = date_trunc('month', target_work_date)::date and mc.reopened_at is null) then raise exception 'period_closed'; end if;
end; $$;

create or replace function public.time_tracking_apply_interval_operations(operations jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare operation jsonb; payload jsonb; existing jsonb;
begin
  if jsonb_typeof(operations) <> 'array' then raise exception 'invalid_state: operations_must_be_array'; end if;
  for operation in select value from jsonb_array_elements(operations) loop
    if operation->>'type' = 'save_idempotent_result' then
      select result into existing from public.time_tracking_idempotency where organization_id=(operation->>'organizationId')::uuid and membership_id=(operation->>'membershipId')::uuid and request_id=(operation->>'requestId')::uuid for update;
      if existing is not null and existing <> operation->'result' then raise exception 'invalid_state: idempotency_result_mismatch'; end if;
      if existing is null then insert into public.time_tracking_idempotency(organization_id,membership_id,request_id,result) values ((operation->>'organizationId')::uuid,(operation->>'membershipId')::uuid,(operation->>'requestId')::uuid,operation->'result'); end if;
    end if;
  end loop;
  for operation in select value from jsonb_array_elements(operations) loop
    case operation->>'type'
      when 'save_idempotent_result' then null;
      when 'insert_session' then
        payload := operation->'session';
        if not exists (select 1 from public.memberships m where m.organization_id=(payload->>'organizationId')::uuid and m.id=(payload->>'membershipId')::uuid and m.status='active') then raise exception 'invalid_state: session_membership_not_active'; end if;
        insert into public.work_sessions(id,organization_id,membership_id,work_date,started_at,ended_at,source,version,archived_at)
        values ((payload->>'id')::uuid,(payload->>'organizationId')::uuid,(payload->>'membershipId')::uuid,(payload->>'workDate')::date,(payload->>'startedAt')::timestamptz,nullif(payload->>'endedAt','')::timestamptz,coalesce(payload->>'source','clock')::public.work_session_source,coalesce((payload->>'version')::int,1),nullif(payload->>'archivedAt','')::timestamptz);
      when 'update_session' then
        payload := operation->'session';
        update public.work_sessions set work_date=(payload->>'workDate')::date,started_at=(payload->>'startedAt')::timestamptz,ended_at=nullif(payload->>'endedAt','')::timestamptz,source=(payload->>'source')::public.work_session_source,version=(payload->>'version')::int,archived_at=nullif(payload->>'archivedAt','')::timestamptz,updated_at=now()
        where organization_id=(payload->>'organizationId')::uuid and membership_id=(payload->>'membershipId')::uuid and id=(payload->>'id')::uuid and version=(payload->>'version')::int-1 and archived_at is null;
        if not found then raise exception 'invalid_state: session_not_found_or_stale'; end if;
      when 'append_clock_event' then
        payload := operation->'event';
        insert into public.clock_events(id,organization_id,work_session_id,membership_id,event_type,occurred_at,recorded_at,request_id)
        select (payload->>'id')::uuid,(payload->>'organizationId')::uuid,(payload->>'workSessionId')::uuid,(payload->>'membershipId')::uuid,(payload->>'eventType')::public.clock_event_type,(payload->>'occurredAt')::timestamptz,(payload->>'recordedAt')::timestamptz,(payload->>'requestId')::uuid
        where exists (select 1 from public.work_sessions s where s.organization_id=(payload->>'organizationId')::uuid and s.membership_id=(payload->>'membershipId')::uuid and s.id=(payload->>'workSessionId')::uuid);
        if not found then raise exception 'invalid_state: clock_event_session_membership_mismatch'; end if;
      when 'append_audit_event' then
        payload := operation->'event';
        insert into public.audit_events(id,organization_id,actor_user_id,actor_membership_id,action,entity_type,entity_id,occurred_at,request_id,before_values,after_values,metadata)
        values ((payload->>'id')::uuid,(payload->>'organizationId')::uuid,(payload->>'actorUserId')::uuid,(payload->>'actorMembershipId')::uuid,payload->>'action',payload->>'entityType',(payload->>'entityId')::uuid,(payload->>'occurredAt')::timestamptz,(payload->>'requestId')::uuid,payload->'beforeValues',payload->'afterValues',coalesce(payload->'metadata','{}'::jsonb));
      else raise exception 'invalid_state: unsupported_operation';
    end case;
  end loop;
end; $$;

revoke all on function public.time_tracking_apply_interval_operations(jsonb) from public, anon, authenticated;
grant execute on function public.time_tracking_apply_interval_operations(jsonb) to service_role;
