create type public.absence_type as enum ('vacation', 'sickness', 'other');
create type public.absence_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create table public.absence_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  membership_id uuid not null,
  type public.absence_type not null,
  starts_on date not null,
  ends_on date not null,
  status public.absence_status not null default 'pending',
  employee_note text,
  review_note text,
  reviewed_by_membership_id uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  request_id uuid not null,
  constraint absence_requests_membership_fk foreign key (organization_id, membership_id)
    references public.memberships(organization_id, id),
  constraint absence_requests_reviewer_fk foreign key (organization_id, reviewed_by_membership_id)
    references public.memberships(organization_id, id),
  constraint absence_requests_dates_check check (ends_on >= starts_on),
  constraint absence_requests_note_check check (
    char_length(coalesce(employee_note, '')) <= 1000
    and char_length(coalesce(review_note, '')) <= 1000
  ),
  unique (organization_id, membership_id, request_id)
);

create index absence_requests_member_dates_idx
  on public.absence_requests(organization_id, membership_id, starts_on, ends_on);
create index absence_requests_review_idx
  on public.absence_requests(organization_id, status, starts_on);

alter table public.absence_requests enable row level security;

create policy absence_requests_read on public.absence_requests
for select to authenticated
using (
  public.is_active_member(organization_id)
  and (
    membership_id in (
      select id from public.memberships
      where organization_id = absence_requests.organization_id
        and user_id = auth.uid() and status = 'active'
    )
    or exists (
      select 1 from public.memberships actor
      where actor.organization_id = absence_requests.organization_id
        and actor.user_id = auth.uid() and actor.status = 'active'
        and actor.role in ('owner', 'admin', 'auditor')
    )
    or exists (
      select 1 from public.memberships actor
      where actor.organization_id = absence_requests.organization_id
        and actor.user_id = auth.uid() and actor.status = 'active'
        and actor.role = 'manager'
        and public.is_attendance_manager_for(
          absence_requests.organization_id,
          actor.id,
          absence_requests.membership_id,
          absence_requests.starts_on
        )
    )
  )
);

revoke all on public.absence_requests from anon, authenticated;
grant select on public.absence_requests to authenticated;
grant all on public.absence_requests to service_role;
