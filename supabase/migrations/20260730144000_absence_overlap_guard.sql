create or replace function public.prevent_overlapping_absence_requests()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status not in ('pending', 'approved') then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.organization_id::text || ':' || new.membership_id::text, 0)
  );

  if exists (
    select 1
    from public.absence_requests existing
    where existing.organization_id = new.organization_id
      and existing.membership_id = new.membership_id
      and existing.id <> new.id
      and existing.status in ('pending', 'approved')
      and daterange(existing.starts_on, existing.ends_on, '[]')
        && daterange(new.starts_on, new.ends_on, '[]')
  ) then
    raise exception 'absence_overlap';
  end if;

  return new;
end;
$$;

create trigger absence_requests_prevent_overlap
before insert or update of organization_id, membership_id, starts_on, ends_on, status
on public.absence_requests
for each row execute function public.prevent_overlapping_absence_requests();
