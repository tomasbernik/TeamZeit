create table public.work_policies (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120), weekly_minutes integer not null check (weekly_minutes between 0 and 10080),
  minimum_break_minutes integer not null default 0 check (minimum_break_minutes between 0 and 1440), archived_at timestamptz, created_at timestamptz not null default now(),
  unique (organization_id, id), unique (organization_id, name)
);
alter table public.memberships add column work_policy_id uuid;
alter table public.memberships add constraint memberships_work_policy_tenant_fk foreign key (organization_id, work_policy_id) references public.work_policies(organization_id, id) on delete restrict;
create index memberships_org_status_idx on public.memberships(organization_id, status, created_at);
create index team_members_membership_idx on public.team_members(organization_id, membership_id, valid_until);
alter table public.work_policies enable row level security;
create policy work_policies_member_read on public.work_policies for select using (public.is_active_member(organization_id));
create policy work_policies_admin_insert on public.work_policies for insert with check (public.has_org_role(organization_id, array['owner','admin']::public.membership_role[]));
create policy work_policies_admin_update on public.work_policies for update using (public.has_org_role(organization_id, array['owner','admin']::public.membership_role[])) with check (public.has_org_role(organization_id, array['owner','admin']::public.membership_role[]));
