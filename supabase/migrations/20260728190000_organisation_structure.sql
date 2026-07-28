create extension if not exists btree_gist;

alter table public.team_members add column if not exists is_primary boolean not null default true;
alter table public.manager_scopes add column if not exists valid_from date not null default current_date;
alter table public.manager_scopes add column if not exists valid_until date;
alter table public.manager_scopes add constraint manager_scopes_valid_range check (valid_until is null or valid_until >= valid_from);

create index if not exists teams_location_idx on public.teams(organization_id, location_id, archived_at);
create index if not exists team_members_effective_idx on public.team_members(organization_id, membership_id, valid_from, valid_until, team_id);
create index if not exists manager_scopes_effective_idx on public.manager_scopes(organization_id, manager_membership_id, valid_from, valid_until);
alter table public.team_members add constraint team_members_one_primary_effective
  exclude using gist (organization_id with =, membership_id with =, daterange(valid_from, coalesce(valid_until + 1, 'infinity'::date), '[)') with &&)
  where (is_primary);

create table public.organisation_structure_idempotency (
  organization_id uuid not null,
  request_id uuid not null,
  actor_membership_id uuid not null,
  operation text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, request_id),
  foreign key (organization_id, actor_membership_id) references public.memberships(organization_id, id) on delete restrict
);
alter table public.organisation_structure_idempotency enable row level security;

drop policy if exists locations_org_read on public.locations;
drop policy if exists teams_org_read on public.teams;
drop policy if exists team_members_org_read on public.team_members;
drop policy if exists manager_scopes_admin_read on public.manager_scopes;

create policy locations_structure_read on public.locations for select using (
  public.has_org_role(organization_id, array['owner','admin']::public.membership_role[])
  or exists (
    select 1 from public.manager_scopes ms where ms.organization_id=locations.organization_id
      and ms.manager_membership_id=public.current_membership_id(locations.organization_id)
      and ms.valid_from<=current_date and (ms.valid_until is null or ms.valid_until>=current_date)
      and (ms.location_id=locations.id or exists(select 1 from public.teams t where t.organization_id=locations.organization_id and t.location_id=locations.id and t.id=ms.team_id))
  )
);
create policy teams_structure_read on public.teams for select using (
  public.has_org_role(organization_id, array['owner','admin']::public.membership_role[])
  or exists (
    select 1 from public.manager_scopes ms where ms.organization_id=teams.organization_id
      and ms.manager_membership_id=public.current_membership_id(teams.organization_id)
      and ms.valid_from<=current_date and (ms.valid_until is null or ms.valid_until>=current_date)
      and (ms.team_id=teams.id or ms.location_id=teams.location_id)
  )
);
create policy team_members_structure_read on public.team_members for select using (
  public.has_org_role(organization_id, array['owner','admin']::public.membership_role[])
  or public.is_attendance_manager_for(organization_id, public.current_membership_id(organization_id), membership_id, current_date)
);
create policy manager_scopes_structure_read on public.manager_scopes for select using (
  public.has_org_role(organization_id, array['owner','admin']::public.membership_role[])
  or manager_membership_id=public.current_membership_id(organization_id)
);

create or replace function public.organisation_structure_read(target_organization_id uuid, actor_membership_id uuid, target_date date)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor public.memberships; result jsonb;
begin
  select * into actor from public.memberships where organization_id=target_organization_id and id=actor_membership_id and status='active';
  if not found or actor.user_id<>auth.uid() then raise exception 'structure_forbidden'; end if;
  if actor.role not in ('owner','admin','manager') then raise exception 'structure_forbidden'; end if;
  select jsonb_build_object(
    'locations',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',l.id,'organizationId',l.organization_id,'name',l.name,'archivedAt',l.archived_at)) order by l.name) from public.locations l where l.organization_id=target_organization_id and (actor.role in ('owner','admin') or exists(select 1 from public.manager_scopes s where s.organization_id=l.organization_id and s.manager_membership_id=actor.id and s.valid_from<=target_date and (s.valid_until is null or s.valid_until>=target_date) and (s.location_id=l.id or exists(select 1 from public.teams st where st.organization_id=l.organization_id and st.location_id=l.id and st.id=s.team_id))))),'[]'::jsonb),
    'teams',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',t.id,'organizationId',t.organization_id,'locationId',t.location_id,'name',t.name,'archivedAt',t.archived_at)) order by t.name) from public.teams t where t.organization_id=target_organization_id and (actor.role in ('owner','admin') or exists(select 1 from public.manager_scopes s where s.organization_id=t.organization_id and s.manager_membership_id=actor.id and s.valid_from<=target_date and (s.valid_until is null or s.valid_until>=target_date) and (s.team_id=t.id or s.location_id=t.location_id)))),'[]'::jsonb),
    'assignments',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('organizationId',tm.organization_id,'teamId',tm.team_id,'membershipId',tm.membership_id,'validFrom',tm.valid_from,'validUntil',tm.valid_until,'primary',tm.is_primary))) from public.team_members tm where tm.organization_id=target_organization_id and tm.valid_from<=target_date and (tm.valid_until is null or tm.valid_until>=target_date) and (actor.role in ('owner','admin') or public.is_attendance_manager_for(target_organization_id,actor.id,tm.membership_id,target_date))),'[]'::jsonb),
    'managerScopes',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',s.id,'organizationId',s.organization_id,'managerMembershipId',s.manager_membership_id,'scopeType',s.scope_type,'locationId',s.location_id,'teamId',s.team_id,'validFrom',s.valid_from,'validUntil',s.valid_until))) from public.manager_scopes s where s.organization_id=target_organization_id and (actor.role in ('owner','admin') or s.manager_membership_id=actor.id)),'[]'::jsonb)
  ) into result;
  return result;
end $$;

create or replace function public.organisation_structure_apply(target_organization_id uuid, actor_membership_id uuid, actor_user_id uuid, command_operation text, command_request_id uuid, command jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor public.memberships; cached jsonb; entity jsonb; entity_id uuid; target_id uuid; before_row jsonb;
begin
  select result into cached from public.organisation_structure_idempotency where organization_id=target_organization_id and request_id=command_request_id;
  if found then return cached; end if;
  select * into actor from public.memberships where organization_id=target_organization_id and id=actor_membership_id and user_id=actor_user_id and status='active';
  if not found or actor.role not in ('owner','admin') then raise exception 'structure_forbidden'; end if;
  if auth.uid() is not null and auth.uid()<>actor_user_id then raise exception 'structure_forbidden'; end if;

  if command_operation='create_location' then
    insert into public.locations(organization_id,name) values(target_organization_id,trim(command->>'name')) returning id,to_jsonb(locations.*) into entity_id,entity;
  elsif command_operation in ('update_location','archive_location') then
    target_id=(command->>'id')::uuid; select to_jsonb(l) into before_row from public.locations l where organization_id=target_organization_id and id=target_id for update;
    if not found then raise exception 'structure_not_found'; end if;
    if command_operation='update_location' then update public.locations set name=trim(command->>'name') where organization_id=target_organization_id and id=target_id returning to_jsonb(locations.*) into entity;
    else update public.locations set archived_at=case when (command->>'archived')::boolean then now() else null end where organization_id=target_organization_id and id=target_id returning to_jsonb(locations.*) into entity; end if; entity_id=target_id;
  elsif command_operation='create_team' then
    insert into public.teams(organization_id,location_id,name) values(target_organization_id,(command->>'locationId')::uuid,trim(command->>'name')) returning id,to_jsonb(teams.*) into entity_id,entity;
  elsif command_operation in ('update_team','archive_team') then
    target_id=(command->>'id')::uuid; select to_jsonb(t) into before_row from public.teams t where organization_id=target_organization_id and id=target_id for update;
    if not found then raise exception 'structure_not_found'; end if;
    if command_operation='update_team' then update public.teams set name=trim(command->>'name'),location_id=(command->>'locationId')::uuid where organization_id=target_organization_id and id=target_id returning to_jsonb(teams.*) into entity;
    else update public.teams set archived_at=case when (command->>'archived')::boolean then now() else null end where organization_id=target_organization_id and id=target_id returning to_jsonb(teams.*) into entity; end if; entity_id=target_id;
  elsif command_operation='set_assignment' then
    insert into public.team_members(organization_id,team_id,membership_id,valid_from,valid_until,is_primary) values(target_organization_id,(command->>'teamId')::uuid,(command->>'membershipId')::uuid,(command->>'validFrom')::date,(command->>'validUntil')::date,coalesce((command->>'primary')::boolean,true))
      returning (jsonb_build_object('organizationId',organization_id,'teamId',team_id,'membershipId',membership_id,'validFrom',valid_from,'validUntil',valid_until,'primary',is_primary)) into entity; entity_id=(command->>'teamId')::uuid;
  elsif command_operation='set_scope' then
    insert into public.manager_scopes(organization_id,manager_membership_id,scope_type,location_id,team_id,valid_from,valid_until) values(target_organization_id,(command->>'managerMembershipId')::uuid,(command->>'scopeType')::public.manager_scope_type,(command->>'locationId')::uuid,(command->>'teamId')::uuid,(command->>'validFrom')::date,(command->>'validUntil')::date)
      returning id,jsonb_strip_nulls(jsonb_build_object('id',id,'organizationId',organization_id,'managerMembershipId',manager_membership_id,'scopeType',scope_type,'locationId',location_id,'teamId',team_id,'validFrom',valid_from,'validUntil',valid_until)) into entity_id,entity;
  else raise exception 'structure_validation'; end if;
  insert into public.audit_events(organization_id,actor_user_id,actor_membership_id,action,entity_type,entity_id,occurred_at,request_id,before_values,after_values) values(target_organization_id,actor_user_id,actor_membership_id,'organisation_structure.'||command_operation,'organisation_structure',entity_id,now(),command_request_id,before_row,entity);
  insert into public.organisation_structure_idempotency(organization_id,request_id,actor_membership_id,operation,result) values(target_organization_id,command_request_id,actor_membership_id,command_operation,entity);
  return entity;
exception when exclusion_violation or unique_violation or foreign_key_violation or check_violation then raise exception 'structure_conflict';
end $$;

revoke all on function public.organisation_structure_read(uuid,uuid,date) from public;
revoke all on function public.organisation_structure_apply(uuid,uuid,uuid,text,uuid,jsonb) from public;
grant execute on function public.organisation_structure_read(uuid,uuid,date) to authenticated,service_role;
grant execute on function public.organisation_structure_apply(uuid,uuid,uuid,text,uuid,jsonb) to service_role;
grant select,insert,update,delete on public.locations,public.teams,public.team_members,public.manager_scopes,public.organisation_structure_idempotency to service_role;
