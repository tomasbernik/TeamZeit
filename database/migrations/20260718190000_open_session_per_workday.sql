drop index if exists public.one_open_session_per_member;
create unique index one_open_session_per_member_workday on public.work_sessions(organization_id, membership_id, work_date) where ended_at is null and archived_at is null;

alter table public.work_sessions drop constraint if exists work_sessions_no_overlap;
alter table public.work_sessions add constraint work_sessions_no_overlap
  exclude using gist (
    organization_id with =,
    membership_id with =,
    work_date with =,
    tstzrange(started_at, coalesce(ended_at, 'infinity'::timestamptz), '[)') with &&
  ) where (archived_at is null);
