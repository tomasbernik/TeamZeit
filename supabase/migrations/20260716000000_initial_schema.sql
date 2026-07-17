-- TeamZeit reference schema for architectural review.
-- Convert into ordered migrations before the first shared deployment.

create extension if not exists pgcrypto;

create type public.membership_role as enum ('owner', 'admin', 'manager', 'employee', 'auditor');
create type public.membership_status as enum ('invited', 'active', 'inactive');
create type public.manager_scope_type as enum ('location', 'team');
create type public.clock_event_type as enum ('clock_in', 'break_start', 'break_end', 'clock_out');
create type public.work_session_source as enum ('clock', 'approved_correction', 'admin_import');
create type public.correction_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  time_zone text not null default 'Europe/Berlin',
  logo_path text,
  theme jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete restrict,
  email text not null,
  role public.membership_role not null default 'employee',
  status public.membership_status not null default 'invited',
  employee_number text,
  contracted_minutes_per_week integer check (contracted_minutes_per_week between 0 and 10080),
  employment_start date,
  employment_end date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (organization_id, id),
  unique (organization_id, user_id),
  unique (organization_id, email),
  check (employment_end is null or employment_start is null or employment_end >= employment_start),
  check (
    (status = 'invited' and user_id is null)
    or (status in ('active', 'inactive') and user_id is not null)
  )
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role public.membership_role not null default 'employee',
  token_hash text not null unique,
  invited_by_membership_id uuid not null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, invited_by_membership_id)
    references public.memberships(organization_id, id) on delete restrict,
  check (expires_at > created_at),
  check (accepted_at is null or revoked_at is null)
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, name)
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid,
  name text not null check (char_length(name) between 1 and 120),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, name),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete restrict
);

create table public.team_members (
  organization_id uuid not null,
  team_id uuid not null,
  membership_id uuid not null,
  valid_from date not null default current_date,
  valid_until date,
  primary key (organization_id, team_id, membership_id, valid_from),
  foreign key (organization_id, team_id)
    references public.teams(organization_id, id) on delete cascade,
  foreign key (organization_id, membership_id)
    references public.memberships(organization_id, id) on delete cascade,
  check (valid_until is null or valid_until >= valid_from)
);

create table public.manager_scopes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  manager_membership_id uuid not null,
  scope_type public.manager_scope_type not null,
  location_id uuid,
  team_id uuid,
  created_at timestamptz not null default now(),
  foreign key (organization_id, manager_membership_id)
    references public.memberships(organization_id, id) on delete cascade,
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, team_id)
    references public.teams(organization_id, id) on delete cascade,
  check (
    (scope_type = 'location' and location_id is not null and team_id is null)
    or (scope_type = 'team' and team_id is not null and location_id is null)
  )
);

create table public.work_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  membership_id uuid not null,
  work_date date not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  source public.work_session_source not null default 'clock',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (organization_id, id),
  foreign key (organization_id, membership_id)
    references public.memberships(organization_id, id) on delete restrict,
  check (ended_at is null or ended_at >= started_at)
);

create table public.work_breaks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  work_session_id uuid not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, work_session_id)
    references public.work_sessions(organization_id, id) on delete cascade,
  check (ended_at is null or ended_at >= started_at)
);

create table public.clock_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  work_session_id uuid not null,
  membership_id uuid not null,
  event_type public.clock_event_type not null,
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  request_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  unique (organization_id, request_id),
  foreign key (organization_id, work_session_id)
    references public.work_sessions(organization_id, id) on delete restrict,
  foreign key (organization_id, membership_id)
    references public.memberships(organization_id, id) on delete restrict
);

create table public.correction_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  requester_membership_id uuid not null,
  work_session_id uuid not null,
  original_values jsonb not null,
  proposed_values jsonb not null,
  reason text not null check (char_length(reason) between 3 and 1000),
  status public.correction_status not null default 'pending',
  reviewed_by_membership_id uuid,
  review_comment text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  version integer not null default 1 check (version > 0),
  unique (organization_id, id),
  foreign key (organization_id, requester_membership_id)
    references public.memberships(organization_id, id) on delete restrict,
  foreign key (organization_id, reviewed_by_membership_id)
    references public.memberships(organization_id, id) on delete restrict,
  foreign key (organization_id, work_session_id)
    references public.work_sessions(organization_id, id) on delete restrict,
  check (reviewed_by_membership_id is null or reviewed_by_membership_id <> requester_membership_id),
  check (
    (status = 'pending' and reviewed_at is null and reviewed_by_membership_id is null)
    or status in ('cancelled')
    or (status in ('approved', 'rejected') and reviewed_at is not null and reviewed_by_membership_id is not null)
  )
);

create table public.month_closures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  membership_id uuid not null,
  month_start date not null check (date_trunc('month', month_start)::date = month_start),
  closed_at timestamptz not null default now(),
  closed_by_membership_id uuid not null,
  reopened_at timestamptz,
  reopened_by_membership_id uuid,
  reopen_reason text,
  unique (organization_id, membership_id, month_start),
  foreign key (organization_id, membership_id)
    references public.memberships(organization_id, id) on delete restrict,
  foreign key (organization_id, closed_by_membership_id)
    references public.memberships(organization_id, id) on delete restrict,
  foreign key (organization_id, reopened_by_membership_id)
    references public.memberships(organization_id, id) on delete restrict,
  check ((reopened_at is null and reopened_by_membership_id is null and reopen_reason is null)
    or (reopened_at is not null and reopened_by_membership_id is not null and char_length(reopen_reason) >= 3))
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_membership_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  occurred_at timestamptz not null default now(),
  request_id uuid,
  before_values jsonb,
  after_values jsonb,
  metadata jsonb not null default '{}'::jsonb,
  foreign key (organization_id, actor_membership_id)
    references public.memberships(organization_id, id) on delete restrict
);

create index memberships_user_status_idx on public.memberships(user_id, status);
create index work_sessions_member_date_idx on public.work_sessions(organization_id, membership_id, work_date);
create unique index one_open_session_per_member
  on public.work_sessions(organization_id, membership_id) where ended_at is null and archived_at is null;
create unique index one_open_break_per_session
  on public.work_breaks(organization_id, work_session_id) where ended_at is null;
create index correction_pending_idx on public.correction_requests(organization_id, status, created_at);
create index audit_entity_idx on public.audit_events(organization_id, entity_type, entity_id, occurred_at desc);

create or replace function public.is_active_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = target_organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function public.current_membership_id(target_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.id from public.memberships m
  where m.organization_id = target_organization_id
    and m.user_id = auth.uid()
    and m.status = 'active'
  limit 1;
$$;

create or replace function public.has_org_role(target_organization_id uuid, allowed_roles public.membership_role[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = target_organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = any(allowed_roles)
  );
$$;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.locations enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.manager_scopes enable row level security;
alter table public.work_sessions enable row level security;
alter table public.work_breaks enable row level security;
alter table public.clock_events enable row level security;
alter table public.correction_requests enable row level security;
alter table public.month_closures enable row level security;
alter table public.audit_events enable row level security;

-- Baseline read isolation. Detailed manager-scope policies belong in reviewed migrations.
create policy organizations_member_read on public.organizations for select
  using (public.is_active_member(id));
create policy profiles_self_read on public.profiles for select using (id = auth.uid());
create policy profiles_self_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy memberships_org_read on public.memberships for select
  using (
    user_id = auth.uid()
    or public.has_org_role(organization_id, array['owner','admin']::public.membership_role[])
  );
create policy invitations_admin_read on public.invitations for select
  using (public.has_org_role(organization_id, array['owner','admin']::public.membership_role[]));
create policy locations_org_read on public.locations for select using (public.is_active_member(organization_id));
create policy teams_org_read on public.teams for select using (public.is_active_member(organization_id));
create policy team_members_org_read on public.team_members for select using (public.is_active_member(organization_id));
create policy manager_scopes_admin_read on public.manager_scopes for select
  using (public.has_org_role(organization_id, array['owner','admin']::public.membership_role[])
    or manager_membership_id = public.current_membership_id(organization_id));
create policy work_sessions_own_read on public.work_sessions for select
  using (membership_id = public.current_membership_id(organization_id));
create policy work_breaks_own_read on public.work_breaks for select
  using (exists (select 1 from public.work_sessions s where s.id = work_session_id
    and s.organization_id = organization_id
    and s.membership_id = public.current_membership_id(organization_id)));
create policy clock_events_own_read on public.clock_events for select
  using (membership_id = public.current_membership_id(organization_id));
create policy corrections_own_read on public.correction_requests for select
  using (requester_membership_id = public.current_membership_id(organization_id));
create policy month_closures_own_read on public.month_closures for select
  using (membership_id = public.current_membership_id(organization_id));
create policy audit_own_read on public.audit_events for select
  using (actor_membership_id = public.current_membership_id(organization_id));

-- Intentional: no direct client INSERT/UPDATE/DELETE policies for attendance,
-- approvals, closures, membership administration, or audit events. These are
-- server-authoritative commands. Manager/admin scoped read policies must be
-- added together with their tested scope functions before those views ship.
