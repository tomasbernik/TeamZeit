create or replace function public.is_absence_manager_for(
  target_organization_id uuid,
  manager_membership_id uuid,
  employee_membership_id uuid,
  target_date date
) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.manager_scopes scope
    where scope.organization_id = target_organization_id
      and scope.manager_membership_id = manager_membership_id
      and scope.valid_from <= target_date
      and (scope.valid_until is null or scope.valid_until >= target_date)
      and (
        (scope.scope_type = 'team' and exists (
          select 1 from public.team_members assignment
          where assignment.organization_id = target_organization_id
            and assignment.membership_id = employee_membership_id
            and assignment.team_id = scope.team_id
            and assignment.valid_from <= target_date
            and (assignment.valid_until is null or assignment.valid_until >= target_date)
        )) or
        (scope.scope_type = 'location' and exists (
          select 1 from public.team_members assignment
          join public.teams team on team.organization_id = assignment.organization_id and team.id = assignment.team_id
          where assignment.organization_id = target_organization_id
            and assignment.membership_id = employee_membership_id
            and team.location_id = scope.location_id
            and assignment.valid_from <= target_date
            and (assignment.valid_until is null or assignment.valid_until >= target_date)
        ))
      )
  );
$$;
revoke all on function public.is_absence_manager_for(uuid, uuid, uuid, date) from public;
grant execute on function public.is_absence_manager_for(uuid, uuid, uuid, date) to service_role;
create or replace function public.absence_apply(
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
  actor public.memberships%rowtype;
  target public.absence_requests%rowtype;
  prior jsonb;
  result jsonb;
  target_id uuid;
  target_version integer;
begin
  select * into actor from public.memberships
  where organization_id = target_organization_id
    and id = actor_membership_id
    and user_id = actor_user_id
    and status = 'active';
  if not found then raise exception 'absence_forbidden'; end if;

  select response into prior from public.absence_idempotency
  where organization_id = target_organization_id
    and membership_id = actor_membership_id
    and request_id = command_request_id;
  if prior is not null then return prior; end if;

  if command_operation = 'create' then
    if actor.role = 'auditor' then raise exception 'absence_forbidden'; end if;
    if (command->>'endsOn')::date < (command->>'startsOn')::date then
      raise exception 'absence_validation';
    end if;
    insert into public.absence_requests (
      organization_id, membership_id, type, starts_on, ends_on,
      employee_note, request_id
    ) values (
      target_organization_id, actor_membership_id,
      (command->>'type')::public.absence_type,
      (command->>'startsOn')::date, (command->>'endsOn')::date,
      nullif(trim(command->>'employeeNote'), ''), command_request_id
    ) returning * into target;
  elsif command_operation in ('cancel', 'review') then
    target_id := (command->>'id')::uuid;
    target_version := (command->>'expectedVersion')::integer;
    select * into target from public.absence_requests
    where organization_id = target_organization_id and id = target_id
    for update;
    if not found then raise exception 'absence_not_found'; end if;
    if target.version <> target_version then raise exception 'absence_conflict'; end if;

    if command_operation = 'cancel' then
      if target.membership_id <> actor_membership_id or target.status <> 'pending' then
        raise exception 'absence_forbidden';
      end if;
      update public.absence_requests set
        status = 'cancelled', updated_at = now(), version = version + 1
      where id = target.id returning * into target;
    else
      if target.status <> 'pending' or actor_membership_id = target.membership_id then
        raise exception 'absence_forbidden';
      end if;
      if actor.role not in ('owner', 'admin') and not (
        actor.role = 'manager' and public.is_absence_manager_for(
          target_organization_id, actor.id, target.membership_id, target.starts_on
        )
      ) then raise exception 'absence_forbidden'; end if;
      if command->>'decision' not in ('approved', 'rejected') then
        raise exception 'absence_validation';
      end if;
      update public.absence_requests set
        status = (command->>'decision')::public.absence_status,
        review_note = nullif(trim(command->>'reviewNote'), ''),
        reviewed_by_membership_id = actor.id, reviewed_at = now(),
        updated_at = now(), version = version + 1
      where id = target.id returning * into target;
    end if;
  else
    raise exception 'absence_validation';
  end if;

  result := jsonb_build_object(
    'id', target.id, 'organizationId', target.organization_id,
    'membershipId', target.membership_id, 'type', target.type,
    'startsOn', target.starts_on, 'endsOn', target.ends_on,
    'status', target.status, 'employeeNote', target.employee_note,
    'reviewNote', target.review_note,
    'reviewedByMembershipId', target.reviewed_by_membership_id,
    'reviewedAt', target.reviewed_at, 'createdAt', target.created_at,
    'version', target.version
  );
  result := jsonb_strip_nulls(result);

  insert into public.audit_events (
    id, organization_id, actor_user_id, actor_membership_id, action,
    entity_type, entity_id, occurred_at, request_id, after_values
  ) values (
    gen_random_uuid(), target_organization_id, actor_user_id, actor_membership_id,
    'absence_request.' || command_operation, 'absence_request', target.id,
    now(), command_request_id, result
  );
  insert into public.absence_idempotency values (
    target_organization_id, actor_membership_id, command_request_id, result, now()
  );
  return result;
exception
  when invalid_text_representation or not_null_violation or check_violation or string_data_right_truncation then
    raise exception 'absence_validation';
end;
$$;

revoke all on function public.absence_apply(uuid, uuid, uuid, text, uuid, jsonb) from public;
grant execute on function public.absence_apply(uuid, uuid, uuid, text, uuid, jsonb) to service_role;
