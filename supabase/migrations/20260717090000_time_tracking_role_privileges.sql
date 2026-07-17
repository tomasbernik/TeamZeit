-- Minimal SQL privileges for Supabase API roles.
-- RLS policies remain the data-isolation boundary for anon/authenticated users.

grant usage on schema public to authenticated, service_role;

grant usage on type
  public.membership_role,
  public.membership_status,
  public.manager_scope_type,
  public.clock_event_type,
  public.work_session_source,
  public.correction_status
to authenticated, service_role;

grant select on table
  public.organizations,
  public.profiles,
  public.memberships,
  public.invitations,
  public.locations,
  public.teams,
  public.team_members,
  public.manager_scopes,
  public.work_sessions,
  public.work_breaks,
  public.clock_events,
  public.correction_requests,
  public.month_closures,
  public.audit_events,
  public.time_tracking_idempotency
to authenticated;

grant update (display_name, updated_at) on table public.profiles to authenticated;

-- Allows RLS to reject direct client attendance writes instead of failing before
-- policy evaluation. No INSERT policy exists for this table.
grant insert on table public.work_sessions to authenticated;

grant select, insert, update on table public.work_sessions to service_role;
grant select, insert, delete on table public.work_breaks to service_role;
grant select, insert, update, delete on table public.clock_events to service_role;
grant select, insert, update on table public.correction_requests to service_role;
grant select, insert, update, delete on table public.audit_events to service_role;
grant select, insert on table public.time_tracking_idempotency to service_role;

revoke execute on function public.is_active_member(uuid) from public;
revoke execute on function public.current_membership_id(uuid) from public;
revoke execute on function public.has_org_role(uuid, public.membership_role[]) from public;
revoke execute on function public.prevent_time_tracking_history_change() from public;
revoke execute on function public.time_tracking_assert_period_open(uuid, uuid, date, text) from public;
revoke execute on function public.time_tracking_apply_operations(jsonb) from public;
revoke execute on function public.is_attendance_manager_for(uuid, uuid, uuid, date) from public;
revoke execute on function public.can_read_attendance(uuid, uuid, date) from public;
revoke execute on function public.can_read_attendance_session(uuid, uuid) from public;

grant execute on function public.is_active_member(uuid) to authenticated;
grant execute on function public.current_membership_id(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.membership_role[]) to authenticated;
grant execute on function public.is_attendance_manager_for(uuid, uuid, uuid, date) to authenticated;
grant execute on function public.can_read_attendance(uuid, uuid, date) to authenticated;
grant execute on function public.can_read_attendance_session(uuid, uuid) to authenticated;

grant execute on function public.time_tracking_assert_period_open(uuid, uuid, date, text) to service_role;
grant execute on function public.time_tracking_apply_operations(jsonb) to service_role;

grant usage, select on all sequences in schema public to service_role;
