-- Manager attendance access must respect both the employee assignment and the
-- manager scope at the date of the attendance record.

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
      and scope.valid_from <= target_work_date
      and (scope.valid_until is null or scope.valid_until >= target_work_date)
      and (
        (
          scope.scope_type = 'team'
          and exists (
            select 1
            from public.team_members assignment
            where assignment.organization_id = target_organization_id
              and assignment.team_id = scope.team_id
              and assignment.membership_id = employee_membership_id
              and assignment.valid_from <= target_work_date
              and (assignment.valid_until is null or assignment.valid_until >= target_work_date)
          )
        )
        or (
          scope.scope_type = 'location'
          and exists (
            select 1
            from public.teams team
            join public.team_members assignment
              on assignment.organization_id = team.organization_id
             and assignment.team_id = team.id
            where team.organization_id = target_organization_id
              and team.location_id = scope.location_id
              and assignment.membership_id = employee_membership_id
              and assignment.valid_from <= target_work_date
              and (assignment.valid_until is null or assignment.valid_until >= target_work_date)
          )
        )
      )
  );
$$;

revoke all on function public.is_attendance_manager_for(uuid, uuid, uuid, date) from public;
grant execute on function public.is_attendance_manager_for(uuid, uuid, uuid, date) to authenticated;
