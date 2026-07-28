create or replace function public.employee_invitation_confirm(
  target_organization_id uuid,
  actor_membership_id uuid,
  actor_user_id uuid,
  target_membership_id uuid,
  target_auth_user_id uuid,
  command_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor_role public.membership_role;
  target_row public.memberships;
  prior_result jsonb;
  result jsonb;
begin
  select role into actor_role
  from public.memberships
  where organization_id = target_organization_id
    and id = actor_membership_id
    and user_id = actor_user_id
    and status = 'active';
  if actor_role is null or actor_role not in ('owner', 'admin') then
    raise exception 'employee_admin_forbidden';
  end if;

  select entry.result into prior_result
  from public.employee_administration_idempotency entry
  where entry.organization_id = target_organization_id
    and entry.actor_membership_id = employee_invitation_confirm.actor_membership_id
    and entry.request_id = command_request_id;
  if prior_result is not null then return prior_result; end if;

  select * into target_row
  from public.memberships
  where organization_id = target_organization_id and id = target_membership_id
  for update;
  if not found then raise exception 'employee_admin_not_found'; end if;
  if target_row.status <> 'invited' then raise exception 'employee_admin_invalid_state'; end if;
  if not exists (
    select 1 from auth.users
    where id = target_auth_user_id and lower(email) = lower(target_row.email)
  ) then raise exception 'employee_admin_invalid_auth_user'; end if;
  if exists (
    select 1 from public.memberships
    where user_id = target_auth_user_id and id <> target_membership_id
      and organization_id = target_organization_id
  ) then raise exception 'employee_admin_duplicate_email'; end if;

  update public.memberships
  set user_id = target_auth_user_id,
      invitation_sent_at = now(),
      updated_at = now(),
      version = version + 1
  where organization_id = target_organization_id and id = target_membership_id
  returning * into target_row;

  result := jsonb_build_object(
    'id', target_row.id,
    'email', target_row.email,
    'role', target_row.role,
    'status', target_row.status,
    'work_policy_id', target_row.work_policy_id,
    'version', target_row.version,
    'invitation_sent_at', target_row.invitation_sent_at
  );

  insert into public.audit_events (
    organization_id, actor_user_id, actor_membership_id, action,
    entity_type, entity_id, request_id, after_values
  ) values (
    target_organization_id, actor_user_id, actor_membership_id,
    'membership.invitation_sent', 'membership', target_membership_id,
    command_request_id, result
  );
  insert into public.employee_administration_idempotency (
    organization_id, actor_membership_id, request_id, result
  ) values (target_organization_id, actor_membership_id, command_request_id, result);

  return result;
end;
$$;

revoke all on function public.employee_invitation_confirm(uuid, uuid, uuid, uuid, uuid, uuid) from public;
revoke all on function public.employee_invitation_confirm(uuid, uuid, uuid, uuid, uuid, uuid) from anon;
revoke all on function public.employee_invitation_confirm(uuid, uuid, uuid, uuid, uuid, uuid) from authenticated;
grant execute on function public.employee_invitation_confirm(uuid, uuid, uuid, uuid, uuid, uuid) to service_role;

create or replace function public.activate_invited_memberships_on_sign_in()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  membership_row public.memberships;
begin
  if new.last_sign_in_at is null or new.last_sign_in_at is not distinct from old.last_sign_in_at then
    return new;
  end if;
  for membership_row in
    update public.memberships
    set status = 'active', updated_at = now(), version = version + 1
    where user_id = new.id and status = 'invited'
    returning *
  loop
    insert into public.audit_events (
      organization_id, actor_user_id, actor_membership_id, action,
      entity_type, entity_id, request_id, after_values
    ) values (
      membership_row.organization_id, new.id, membership_row.id,
      'membership.invitation_accepted', 'membership', membership_row.id,
      gen_random_uuid(), jsonb_build_object('status', 'active')
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists activate_invited_memberships_after_sign_in on auth.users;
create trigger activate_invited_memberships_after_sign_in
after update of last_sign_in_at on auth.users
for each row execute function public.activate_invited_memberships_on_sign_in();
