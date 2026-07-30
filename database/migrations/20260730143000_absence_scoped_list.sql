create or replace function public.absence_list(
  target_organization_id uuid,
  actor_membership_id uuid,
  actor_user_id uuid
) returns setof public.absence_requests
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  actor public.memberships%rowtype;
begin
  select *
  into actor
  from public.memberships
  where organization_id = target_organization_id
    and id = actor_membership_id
    and user_id = actor_user_id
    and status = 'active';

  if not found then
    raise exception 'absence_forbidden';
  end if;

  return query
  select request.*
  from public.absence_requests request
  where request.organization_id = target_organization_id
    and (
      request.membership_id = actor.id
      or actor.role in ('owner', 'admin', 'auditor')
      or (
        actor.role = 'manager'
        and public.is_absence_manager_for(
          request.organization_id,
          actor.id,
          request.membership_id,
          request.starts_on
        )
      )
    )
  order by request.starts_on desc, request.created_at desc;
end;
$$;

revoke all on function public.absence_list(uuid, uuid, uuid) from public;
grant execute on function public.absence_list(uuid, uuid, uuid) to service_role;
