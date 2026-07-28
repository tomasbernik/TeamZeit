create or replace function public.identity_bootstrap_organization(
  owner_email text,
  owner_display_name text,
  organization_name text,
  organization_slug text,
  command_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  normalized_email text := lower(trim(owner_email));
  target_user_id uuid;
  new_organization_id uuid := gen_random_uuid();
  new_membership_id uuid := gen_random_uuid();
begin
  if char_length(trim(owner_display_name)) not between 1 and 120 then
    raise exception 'identity_bootstrap_invalid_display_name';
  end if;
  if char_length(trim(organization_name)) not between 2 and 160 then
    raise exception 'identity_bootstrap_invalid_organization_name';
  end if;
  if organization_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'identity_bootstrap_invalid_slug';
  end if;
  if command_request_id is null then
    raise exception 'identity_bootstrap_request_id_required';
  end if;

  select id
  into target_user_id
  from auth.users
  where lower(email) = normalized_email
  limit 1;

  if target_user_id is null then
    raise exception 'identity_bootstrap_auth_user_missing';
  end if;

  if exists (select 1 from public.organizations where slug = organization_slug) then
    raise exception 'identity_bootstrap_organization_exists';
  end if;

  insert into public.profiles (id, display_name)
  values (target_user_id, trim(owner_display_name))
  on conflict (id) do update
    set display_name = excluded.display_name,
        updated_at = now();

  insert into public.organizations (id, name, slug, time_zone)
  values (new_organization_id, trim(organization_name), organization_slug, 'Europe/Berlin');

  insert into public.memberships (
    id,
    organization_id,
    user_id,
    email,
    role,
    status,
    employment_start
  )
  values (
    new_membership_id,
    new_organization_id,
    target_user_id,
    normalized_email,
    'owner',
    'active',
    current_date
  );

  insert into public.audit_events (
    organization_id,
    actor_user_id,
    actor_membership_id,
    action,
    entity_type,
    entity_id,
    request_id,
    after_values,
    metadata
  )
  values (
    new_organization_id,
    target_user_id,
    new_membership_id,
    'organization.bootstrapped',
    'organization',
    new_organization_id,
    command_request_id,
    jsonb_build_object(
      'name', trim(organization_name),
      'slug', organization_slug,
      'ownerMembershipId', new_membership_id
    ),
    jsonb_build_object('source', 'deployment-bootstrap')
  );

  return jsonb_build_object(
    'organizationId', new_organization_id,
    'membershipId', new_membership_id,
    'userId', target_user_id
  );
end;
$$;

revoke all on function public.identity_bootstrap_organization(text, text, text, text, uuid) from public;
revoke all on function public.identity_bootstrap_organization(text, text, text, text, uuid) from anon;
revoke all on function public.identity_bootstrap_organization(text, text, text, text, uuid) from authenticated;
grant execute on function public.identity_bootstrap_organization(text, text, text, text, uuid) to service_role;
