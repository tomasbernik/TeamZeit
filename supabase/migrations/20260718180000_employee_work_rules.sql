create table public.employee_work_rules (
  id uuid primary key,
  organization_id uuid not null,
  membership_id uuid not null,
  effective_from date not null,
  effective_to date,
  weekday_minutes jsonb not null,
  break_threshold_minutes integer not null default 360 check (break_threshold_minutes between 0 and 1440),
  minimum_break_minutes integer not null default 30 check (minimum_break_minutes between 0 and 1440),
  created_at timestamptz not null default now(),
  unique (organization_id, membership_id, effective_from),
  foreign key (organization_id, membership_id) references public.memberships(organization_id, id) on delete cascade,
  check (effective_to is null or effective_to >= effective_from),
  check (jsonb_typeof(weekday_minutes) = 'object')
);

create table public.organization_holidays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  holiday_date date not null,
  name text not null check (char_length(name) between 1 and 160),
  created_at timestamptz not null default now(),
  unique (organization_id, holiday_date)
);

create index employee_work_rules_effective_idx on public.employee_work_rules(organization_id, membership_id, effective_from desc);
create index organization_holidays_date_idx on public.organization_holidays(organization_id, holiday_date);

alter table public.employee_work_rules enable row level security;
alter table public.organization_holidays enable row level security;
create policy employee_work_rules_own_read on public.employee_work_rules for select using (public.is_active_member(organization_id) and membership_id = public.current_membership_id(organization_id));
create policy employee_work_rules_admin_read on public.employee_work_rules for select using (public.has_org_role(organization_id, array['owner','admin']::public.membership_role[]));
create policy organization_holidays_member_read on public.organization_holidays for select using (public.is_active_member(organization_id));
create policy organization_holidays_admin_write on public.organization_holidays for all using (public.has_org_role(organization_id, array['owner','admin']::public.membership_role[])) with check (public.has_org_role(organization_id, array['owner','admin']::public.membership_role[]));

create or replace function public.time_tracking_effective_work_rule(target_organization_id uuid, target_membership_id uuid, target_work_date date)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id',r.id,'organizationId',r.organization_id,'membershipId',r.membership_id,'effectiveFrom',r.effective_from,'effectiveTo',r.effective_to,'weekdayMinutes',r.weekday_minutes,'breakThresholdMinutes',r.break_threshold_minutes,'minimumBreakMinutes',r.minimum_break_minutes)
  from public.employee_work_rules r where r.organization_id=target_organization_id and r.membership_id=target_membership_id and r.effective_from<=target_work_date and (r.effective_to is null or r.effective_to>=target_work_date)
  order by r.effective_from desc limit 1;
$$;

create or replace function public.time_tracking_is_holiday(target_organization_id uuid, target_work_date date)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from public.organization_holidays h where h.organization_id=target_organization_id and h.holiday_date=target_work_date);
$$;

create or replace function public.time_tracking_set_employee_work_rule(target_organization_id uuid, target_membership_id uuid, target_rule_id uuid, target_effective_from date, target_weekday_minutes jsonb, target_break_threshold_minutes integer, target_minimum_break_minutes integer, target_audit_event jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare result jsonb;
begin
  if not exists(select 1 from public.memberships m where m.organization_id=target_organization_id and m.id=target_membership_id and m.status='active') then raise exception 'invalid_state: target_membership_not_active'; end if;
  if target_break_threshold_minutes not between 0 and 1440 or target_minimum_break_minutes not between 0 and 1440 then raise exception 'invalid_state: invalid_break_rule'; end if;
  update public.employee_work_rules set effective_to=target_effective_from-1 where organization_id=target_organization_id and membership_id=target_membership_id and effective_from<target_effective_from and (effective_to is null or effective_to>=target_effective_from);
  insert into public.employee_work_rules(id,organization_id,membership_id,effective_from,weekday_minutes,break_threshold_minutes,minimum_break_minutes)
  values(target_rule_id,target_organization_id,target_membership_id,target_effective_from,target_weekday_minutes,target_break_threshold_minutes,target_minimum_break_minutes);
  insert into public.audit_events(id,organization_id,actor_user_id,actor_membership_id,action,entity_type,entity_id,occurred_at,request_id,after_values,metadata)
  values((target_audit_event->>'id')::uuid,target_organization_id,(target_audit_event->>'actorUserId')::uuid,(target_audit_event->>'actorMembershipId')::uuid,target_audit_event->>'action',target_audit_event->>'entityType',target_rule_id,(target_audit_event->>'occurredAt')::timestamptz,(target_audit_event->>'requestId')::uuid,target_audit_event->'afterValues',coalesce(target_audit_event->'metadata','{}'::jsonb));
  result := public.time_tracking_effective_work_rule(target_organization_id,target_membership_id,target_effective_from);
  return result;
end; $$;

revoke all on function public.time_tracking_effective_work_rule(uuid,uuid,date), public.time_tracking_is_holiday(uuid,date), public.time_tracking_set_employee_work_rule(uuid,uuid,uuid,date,jsonb,integer,integer,jsonb) from public, anon, authenticated;
grant execute on function public.time_tracking_effective_work_rule(uuid,uuid,date), public.time_tracking_is_holiday(uuid,date), public.time_tracking_set_employee_work_rule(uuid,uuid,uuid,date,jsonb,integer,integer,jsonb) to service_role;
grant select on public.employee_work_rules, public.organization_holidays to authenticated;
grant insert, update, delete on public.organization_holidays to authenticated;
