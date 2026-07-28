alter table public.month_closures add column reason text;
alter table public.month_closures add constraint month_closures_reason_length check (reason is null or char_length(reason) between 3 and 500);
create index month_closures_open_lookup_idx on public.month_closures(organization_id, membership_id, month_start) where reopened_at is null;
create or replace function public.month_closing_apply(operation text,target_organization_id uuid,actor_membership_id uuid,actor_user_id uuid,target_membership_id uuid,target_month_start date,command_reason text,command_request_id uuid,command_occurred_at timestamptz)
returns public.month_closures language plpgsql security definer set search_path=public,pg_temp as $$
declare closure public.month_closures; prior jsonb; expected_action text;
begin
 if operation not in ('close','reopen') or target_month_start<>date_trunc('month',target_month_start)::date or char_length(trim(command_reason)) not between 3 and 500 then raise exception 'validation: invalid_month_closing_command'; end if;
 if not exists(select 1 from public.memberships m where m.organization_id=target_organization_id and m.id=actor_membership_id and m.user_id=actor_user_id and m.status='active' and m.role in ('owner','admin')) then raise exception 'forbidden: month_closing_admin_required'; end if;
 if not exists(select 1 from public.memberships m where m.organization_id=target_organization_id and m.id=target_membership_id and m.status='active') then raise exception 'target_not_found'; end if;
 expected_action:=case operation when 'close' then 'month_closure.closed' else 'month_closure.reopened' end;
 select mc.* into closure from public.audit_events ae join public.month_closures mc on mc.id=ae.entity_id and mc.organization_id=ae.organization_id where ae.organization_id=target_organization_id and ae.request_id=command_request_id and ae.action=expected_action limit 1; if found then return closure; end if;
 if exists(select 1 from public.audit_events where organization_id=target_organization_id and request_id=command_request_id) then raise exception 'validation: idempotency_key_reused'; end if;
 select * into closure from public.month_closures where organization_id=target_organization_id and membership_id=target_membership_id and month_start=target_month_start for update; prior:=case when found then to_jsonb(closure) else null end;
 if operation='close' then
  if closure.id is not null and closure.reopened_at is null then raise exception 'already_closed'; end if;
  if closure.id is null then insert into public.month_closures(organization_id,membership_id,month_start,closed_at,closed_by_membership_id,reason) values(target_organization_id,target_membership_id,target_month_start,command_occurred_at,actor_membership_id,trim(command_reason)) returning * into closure;
  else update public.month_closures set closed_at=command_occurred_at,closed_by_membership_id=actor_membership_id,reopened_at=null,reopened_by_membership_id=null,reopen_reason=null,reason=trim(command_reason) where id=closure.id returning * into closure; end if;
 else
  if closure.id is null or closure.reopened_at is not null then raise exception 'already_open'; end if;
  update public.month_closures set reopened_at=command_occurred_at,reopened_by_membership_id=actor_membership_id,reopen_reason=trim(command_reason),reason=trim(command_reason) where id=closure.id returning * into closure;
 end if;
 insert into public.audit_events(organization_id,actor_user_id,actor_membership_id,action,entity_type,entity_id,occurred_at,request_id,before_values,after_values,metadata) values(target_organization_id,actor_user_id,actor_membership_id,expected_action,'month_closure',closure.id,command_occurred_at,command_request_id,prior,to_jsonb(closure),jsonb_build_object('reason',trim(command_reason),'membershipId',target_membership_id,'monthStart',target_month_start)); return closure;
end; $$;
revoke all on function public.month_closing_apply(text,uuid,uuid,uuid,uuid,date,text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.month_closing_apply(text,uuid,uuid,uuid,uuid,date,text,uuid,timestamptz) to service_role;
grant select on public.month_closures to authenticated,service_role; grant insert,update on public.month_closures to service_role;
drop policy if exists month_closures_scoped_read on public.month_closures; drop policy if exists month_closures_own_read on public.month_closures;
create policy month_closures_read on public.month_closures for select using(membership_id=public.current_membership_id(organization_id) or public.has_org_role(organization_id,array['owner','admin','auditor']::public.membership_role[]));
