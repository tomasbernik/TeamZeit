alter table public.memberships
  add column if not exists invitation_sent_at timestamptz;

create table public.employee_administration_idempotency (
  organization_id uuid not null,
  actor_membership_id uuid not null,
  request_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, actor_membership_id, request_id),
  foreign key (organization_id, actor_membership_id)
    references public.memberships(organization_id, id) on delete cascade
);

alter table public.employee_administration_idempotency enable row level security;

create or replace function public.employee_administration_apply(
  target_organization_id uuid,
  actor_membership_id uuid,
  actor_user_id uuid,
  command_operation text,
  command_request_id uuid,
  command jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_role public.membership_role;
  target_id uuid;
  target_role public.membership_role;
  target_row public.memberships%rowtype;
  prior_result jsonb;
  result jsonb;
begin
  select role into actor_role
  from public.memberships
  where organization_id = target_organization_id
    and id = actor_membership_id
    and user_id = actor_user_id
    and status = 'active';

  if actor_role is null or actor_role not in ('owner', 'admin') then
    raise exception 'employee_admin_forbidden';
  end if;

  select e.result into prior_result
  from public.employee_administration_idempotency e
  where e.organization_id = target_organization_id
    and e.actor_membership_id = employee_administration_apply.actor_membership_id
    and e.request_id = command_request_id;
  if prior_result is not null then return prior_result; end if;

  if command_operation = 'create' then
    target_role := (command->>'role')::public.membership_role;
    if target_role in ('owner', 'admin') and actor_role <> 'owner' then
      raise exception 'employee_admin_owner_required';
    end if;
    if exists (
      select 1 from public.memberships
      where organization_id = target_organization_id and lower(email) = lower(command->>'email')
    ) then raise exception 'employee_admin_duplicate_email'; end if;
    if command ? 'workPolicyId' and not exists (
      select 1 from public.work_policies
      where organization_id = target_organization_id and id = (command->>'workPolicyId')::uuid
    ) then raise exception 'employee_admin_invalid_reference'; end if;

    insert into public.memberships (organization_id, email, role, status, work_policy_id)
    values (
      target_organization_id,
      lower(trim(command->>'email')),
      target_role,
      'invited',
      case when command ? 'workPolicyId' then (command->>'workPolicyId')::uuid else null end
    ) returning * into target_row;
    target_id := target_row.id;
  else
    target_id := (command->>'membershipId')::uuid;
    select * into target_row from public.memberships
    where organization_id = target_organization_id and id = target_id for update;
    if not found then raise exception 'employee_admin_not_found'; end if;

    if command_operation = 'send_invitation' then
      if target_row.status <> 'invited' then raise exception 'employee_admin_invalid_state'; end if;
      update public.memberships
      set invitation_sent_at = now(), updated_at = now(), version = version + 1
      where organization_id = target_organization_id and id = target_id
      returning * into target_row;
    elsif command_operation = 'deactivate' then
      if target_id = actor_membership_id or target_row.status <> 'active' then
        raise exception 'employee_admin_invalid_state';
      end if;
      if target_row.version <> (command->>'expectedVersion')::integer then
        raise exception 'employee_admin_version_conflict';
      end if;
      update public.memberships
      set status = 'inactive', updated_at = now(), version = version + 1
      where organization_id = target_organization_id and id = target_id
      returning * into target_row;
    elsif command_operation = 'update_assignment' then
      if target_row.version <> (command->>'expectedVersion')::integer then
        raise exception 'employee_admin_version_conflict';
      end if;
      target_role := coalesce((command->>'role')::public.membership_role, target_row.role);
      if target_role in ('owner', 'admin') and actor_role <> 'owner' then
        raise exception 'employee_admin_owner_required';
      end if;
      if command ? 'workPolicyId' and command->>'workPolicyId' is not null and not exists (
        select 1 from public.work_policies
        where organization_id = target_organization_id and id = (command->>'workPolicyId')::uuid
      ) then raise exception 'employee_admin_invalid_reference'; end if;
      if command ? 'teamId' and command->>'teamId' is not null and not exists (
        select 1 from public.teams
        where organization_id = target_organization_id and id = (command->>'teamId')::uuid
      ) then raise exception 'employee_admin_invalid_reference'; end if;

      update public.memberships
      set role = target_role,
          work_policy_id = case when command ? 'workPolicyId'
            then nullif(command->>'workPolicyId', '')::uuid else work_policy_id end,
          updated_at = now(),
          version = version + 1
      where organization_id = target_organization_id and id = target_id
      returning * into target_row;

      if command ? 'teamId' then
        delete from public.team_members
        where organization_id = target_organization_id
          and membership_id = target_id
          and valid_from = current_date;
        update public.team_members set valid_until = current_date - 1
        where organization_id = target_organization_id
          and membership_id = target_id
          and valid_from < current_date
          and (valid_until is null or valid_until >= current_date);
        if command->>'teamId' is not null then
          insert into public.team_members (organization_id, team_id, membership_id, valid_from)
          values (target_organization_id, (command->>'teamId')::uuid, target_id, current_date);
        end if;
      end if;
    else
      raise exception 'employee_admin_invalid_state';
    end if;
  end if;

  select jsonb_build_object(
    'id', m.id,
    'email', m.email,
    'role', m.role,
    'status', m.status,
    'work_policy_id', m.work_policy_id,
    'version', m.version,
    'invitation_sent_at', m.invitation_sent_at
  ) into result
  from public.memberships m
  where m.organization_id = target_organization_id and m.id = target_id;

  insert into public.audit_events (
    organization_id, actor_user_id, actor_membership_id, action,
    entity_type, entity_id, request_id, after_values
  ) values (
    target_organization_id, actor_user_id, actor_membership_id,
    'membership.' || command_operation, 'membership', target_id,
    command_request_id, result
  );

  insert into public.employee_administration_idempotency (
    organization_id, actor_membership_id, request_id, result
  ) values (target_organization_id, actor_membership_id, command_request_id, result);

  return result;
exception
  when unique_violation then
    raise exception 'employee_admin_duplicate_email';
end;
$$;

revoke all on function public.employee_administration_apply(uuid,uuid,uuid,text,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.employee_administration_apply(uuid,uuid,uuid,text,uuid,jsonb)
  to service_role;
