create or replace function public.time_tracking_set_employee_work_rule(
  target_organization_id uuid,
  target_membership_id uuid,
  target_rule_id uuid,
  target_effective_from date,
  target_weekday_minutes jsonb,
  target_break_threshold_minutes integer,
  target_minimum_break_minutes integer,
  target_audit_event jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
  actual_rule_id uuid;
  next_effective_from date;
begin
  if not exists (
    select 1 from public.memberships m
    where m.organization_id = target_organization_id
      and m.id = target_membership_id
      and m.status = 'active'
  ) then raise exception 'invalid_state: target_membership_not_active'; end if;
  if target_break_threshold_minutes not between 0 and 1440
    or target_minimum_break_minutes not between 0 and 1440
  then raise exception 'invalid_state: invalid_break_rule'; end if;

  select min(r.effective_from) into next_effective_from
  from public.employee_work_rules r
  where r.organization_id = target_organization_id
    and r.membership_id = target_membership_id
    and r.effective_from > target_effective_from;

  update public.employee_work_rules
  set effective_to = target_effective_from - 1
  where organization_id = target_organization_id
    and membership_id = target_membership_id
    and effective_from < target_effective_from
    and (effective_to is null or effective_to >= target_effective_from);

  insert into public.employee_work_rules (
    id, organization_id, membership_id, effective_from, effective_to,
    weekday_minutes, break_threshold_minutes, minimum_break_minutes
  ) values (
    target_rule_id, target_organization_id, target_membership_id, target_effective_from,
    case when next_effective_from is null then null else next_effective_from - 1 end,
    target_weekday_minutes, target_break_threshold_minutes, target_minimum_break_minutes
  )
  on conflict (organization_id, membership_id, effective_from) do update
  set effective_to = excluded.effective_to,
      weekday_minutes = excluded.weekday_minutes,
      break_threshold_minutes = excluded.break_threshold_minutes,
      minimum_break_minutes = excluded.minimum_break_minutes
  returning id into actual_rule_id;

  insert into public.audit_events (
    id, organization_id, actor_user_id, actor_membership_id, action,
    entity_type, entity_id, occurred_at, request_id, after_values, metadata
  ) values (
    (target_audit_event->>'id')::uuid,
    target_organization_id,
    (target_audit_event->>'actorUserId')::uuid,
    (target_audit_event->>'actorMembershipId')::uuid,
    target_audit_event->>'action',
    target_audit_event->>'entityType',
    actual_rule_id,
    (target_audit_event->>'occurredAt')::timestamptz,
    (target_audit_event->>'requestId')::uuid,
    target_audit_event->'afterValues',
    coalesce(target_audit_event->'metadata', '{}'::jsonb)
  );

  result := public.time_tracking_effective_work_rule(
    target_organization_id,
    target_membership_id,
    target_effective_from
  );
  return result;
end;
$$;

revoke all on function public.time_tracking_set_employee_work_rule(uuid,uuid,uuid,date,jsonb,integer,integer,jsonb)
  from public, anon, authenticated;
grant execute on function public.time_tracking_set_employee_work_rule(uuid,uuid,uuid,date,jsonb,integer,integer,jsonb)
  to service_role;
