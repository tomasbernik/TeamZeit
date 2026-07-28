create or replace function public.reporting_monthly_attendance(
  target_organization_id uuid,
  actor_membership_id uuid,
  actor_user_id uuid,
  target_month date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  actor public.memberships;
  month_start date := date_trunc('month', target_month)::date;
  month_end date := (date_trunc('month', target_month) + interval '1 month - 1 day')::date;
  report_rows jsonb;
  report_totals jsonb;
begin
  if target_month <> month_start then raise exception 'reporting_invalid_month'; end if;
  select * into actor from public.memberships
  where organization_id = target_organization_id and id = actor_membership_id
    and user_id = actor_user_id and status = 'active';
  if not found or actor.role not in ('owner', 'admin', 'manager', 'auditor') then
    raise exception 'reporting_forbidden';
  end if;

  with permitted_sessions as (
    select session.*
    from public.work_sessions session
    where session.organization_id = target_organization_id
      and session.work_date between month_start and month_end
      and session.archived_at is null
      and (
        actor.role in ('owner', 'admin', 'auditor')
        or (
          actor.role = 'manager'
          and exists (
            select 1
            from public.manager_scopes scope
            where scope.organization_id = target_organization_id
              and scope.manager_membership_id = actor.id
              and scope.valid_from <= session.work_date
              and (scope.valid_until is null or scope.valid_until >= session.work_date)
              and exists (
                select 1
                from public.team_members assignment
                join public.teams team
                  on team.organization_id = assignment.organization_id
                 and team.id = assignment.team_id
                where assignment.organization_id = target_organization_id
                  and assignment.membership_id = session.membership_id
                  and assignment.valid_from <= session.work_date
                  and (assignment.valid_until is null or assignment.valid_until >= session.work_date)
                  and (
                    (scope.scope_type = 'team' and scope.team_id = assignment.team_id)
                    or (scope.scope_type = 'location' and scope.location_id = team.location_id)
                  )
              )
          )
        )
      )
  ), employee_rows as (
    select membership.id as membership_id, membership.email,
      coalesce(sum(case when session.ended_at is not null then floor(extract(epoch from (session.ended_at - session.started_at)) / 60)::integer else 0 end), 0)::integer as worked_minutes,
      count(*)::integer as session_count,
      count(distinct session.work_date)::integer as days_worked,
      count(*) filter (where session.ended_at is null)::integer as open_session_count
    from permitted_sessions session
    join public.memberships membership
      on membership.organization_id = session.organization_id and membership.id = session.membership_id
    group by membership.id, membership.email
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'membershipId', membership_id, 'email', email, 'workedMinutes', worked_minutes,
      'sessionCount', session_count, 'daysWorked', days_worked, 'openSessionCount', open_session_count
    ) order by email), '[]'::jsonb),
    jsonb_build_object(
      'workedMinutes', coalesce(sum(worked_minutes), 0),
      'sessionCount', coalesce(sum(session_count), 0),
      'daysWorked', coalesce(sum(days_worked), 0),
      'openSessionCount', coalesce(sum(open_session_count), 0)
    )
  into report_rows, report_totals
  from employee_rows;

  return jsonb_build_object(
    'organizationId', target_organization_id,
    'month', to_char(month_start, 'YYYY-MM'),
    'rows', report_rows,
    'totals', report_totals
  );
end;
$$;

revoke all on function public.reporting_monthly_attendance(uuid, uuid, uuid, date) from public;
revoke all on function public.reporting_monthly_attendance(uuid, uuid, uuid, date) from anon;
revoke all on function public.reporting_monthly_attendance(uuid, uuid, uuid, date) from authenticated;
grant execute on function public.reporting_monthly_attendance(uuid, uuid, uuid, date) to service_role;
