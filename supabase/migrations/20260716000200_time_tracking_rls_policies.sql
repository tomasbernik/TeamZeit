-- Time Tracking tenant RLS for employee, manager, admin, owner, and auditor reads.

create or replace function public.is_attendance_manager_for(
  target_organization_id uuid,
  manager_membership_id uuid,
  employee_membership_id uuid,
  target_work_date date
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.memberships manager
    join public.manager_scopes scope
      on scope.organization_id = manager.organization_id
     and scope.manager_membership_id = manager.id
    where manager.organization_id = target_organization_id
      and manager.id = manager_membership_id
      and manager.user_id = auth.uid()
      and manager.status = 'active'
      and manager.role = 'manager'
      and (
        (
          scope.scope_type = 'team'
          and exists (
            select 1
            from public.team_members tm
            where tm.organization_id = target_organization_id
              and tm.team_id = scope.team_id
              and tm.membership_id = employee_membership_id
              and tm.valid_from <= target_work_date
              and (tm.valid_until is null or tm.valid_until >= target_work_date)
          )
        )
        or (
          scope.scope_type = 'location'
          and exists (
            select 1
            from public.teams t
            join public.team_members tm
              on tm.organization_id = t.organization_id
             and tm.team_id = t.id
            where t.organization_id = target_organization_id
              and t.location_id = scope.location_id
              and tm.membership_id = employee_membership_id
              and tm.valid_from <= target_work_date
              and (tm.valid_until is null or tm.valid_until >= target_work_date)
          )
        )
      )
  );
$$;

create or replace function public.can_read_attendance(
  target_organization_id uuid,
  target_membership_id uuid,
  target_work_date date
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    target_membership_id = public.current_membership_id(target_organization_id)
    or public.has_org_role(target_organization_id, array['owner','admin','auditor']::public.membership_role[])
    or public.is_attendance_manager_for(
      target_organization_id,
      public.current_membership_id(target_organization_id),
      target_membership_id,
      target_work_date
    );
$$;

create or replace function public.can_read_attendance_session(target_organization_id uuid, target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.work_sessions ws
    where ws.organization_id = target_organization_id
      and ws.id = target_session_id
      and public.can_read_attendance(ws.organization_id, ws.membership_id, ws.work_date)
  );
$$;

drop policy if exists time_tracking_idempotency_own_read on public.time_tracking_idempotency;
create policy time_tracking_idempotency_own_read
  on public.time_tracking_idempotency
  for select
  using (membership_id = public.current_membership_id(organization_id));

drop policy if exists work_sessions_scoped_read on public.work_sessions;
create policy work_sessions_scoped_read
  on public.work_sessions
  for select
  using (public.can_read_attendance(organization_id, membership_id, work_date));

drop policy if exists work_breaks_scoped_read on public.work_breaks;
create policy work_breaks_scoped_read
  on public.work_breaks
  for select
  using (public.can_read_attendance_session(organization_id, work_session_id));

drop policy if exists clock_events_scoped_read on public.clock_events;
create policy clock_events_scoped_read
  on public.clock_events
  for select
  using (
    exists (
      select 1
      from public.work_sessions ws
      where ws.organization_id = clock_events.organization_id
        and ws.id = clock_events.work_session_id
        and public.can_read_attendance(ws.organization_id, ws.membership_id, ws.work_date)
    )
  );

drop policy if exists corrections_scoped_read on public.correction_requests;
create policy corrections_scoped_read
  on public.correction_requests
  for select
  using (
    requester_membership_id = public.current_membership_id(organization_id)
    or public.has_org_role(organization_id, array['owner','admin']::public.membership_role[])
    or public.is_attendance_manager_for(
      organization_id,
      public.current_membership_id(organization_id),
      requester_membership_id,
      (proposed_values->>'workDate')::date
    )
  );

drop policy if exists month_closures_scoped_read on public.month_closures;
create policy month_closures_scoped_read
  on public.month_closures
  for select
  using (
    membership_id = public.current_membership_id(organization_id)
    or public.has_org_role(organization_id, array['owner','admin','auditor']::public.membership_role[])
    or public.is_attendance_manager_for(
      organization_id,
      public.current_membership_id(organization_id),
      membership_id,
      month_start
    )
  );

drop policy if exists audit_events_scoped_read on public.audit_events;
create policy audit_events_scoped_read
  on public.audit_events
  for select
  using (
    actor_membership_id = public.current_membership_id(organization_id)
    or public.has_org_role(organization_id, array['owner','admin','auditor']::public.membership_role[])
  );
