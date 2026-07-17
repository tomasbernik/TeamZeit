-- Fictional local-only data for RLS and integration testing.
-- Do not copy these IDs or records to any shared or production project.

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'employee.one@example.test', crypt('local-only-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Erika Beispiel"}', now(), now()),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'employee.two@example.test', crypt('local-only-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Emil Beispiel"}', now(), now()),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@example.test', crypt('local-only-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Olivia Owner"}', now(), now()),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@example.test', crypt('local-only-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Anton Admin"}', now(), now()),
  ('10000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manager@example.test', crypt('local-only-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Mara Manager"}', now(), now()),
  ('10000000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'auditor@example.test', crypt('local-only-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Artur Audit"}', now(), now()),
  ('10000000-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'foreign.employee@example.test', crypt('local-only-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Frida Fremd"}', now(), now())
on conflict (id) do nothing;

-- GoTrue scans these token fields as strings when handling passwordless email
-- login. Keep fictional seed users compatible with current local Auth schemas.
update auth.users
set
  confirmation_token = coalesce(confirmation_token, ''),
  recovery_token = coalesce(recovery_token, ''),
  email_change_token_new = coalesce(email_change_token_new, ''),
  email_change = coalesce(email_change, ''),
  phone_change = coalesce(phone_change, ''),
  phone_change_token = coalesce(phone_change_token, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  reauthentication_token = coalesce(reauthentication_token, '')
where id in (
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-000000000007'
);

insert into public.organizations (id, name, slug, time_zone) values
  ('20000000-0000-4000-8000-000000000001', 'Fiktive Werkstatt Nord', 'fiktive-werkstatt-nord', 'Europe/Berlin'),
  ('20000000-0000-4000-8000-000000000002', 'Fiktives Buero Sued', 'fiktives-buero-sued', 'Europe/Berlin')
on conflict (id) do nothing;

insert into public.profiles (id, display_name) values
  ('10000000-0000-4000-8000-000000000001', 'Erika Beispiel'),
  ('10000000-0000-4000-8000-000000000002', 'Emil Beispiel'),
  ('10000000-0000-4000-8000-000000000003', 'Olivia Owner'),
  ('10000000-0000-4000-8000-000000000004', 'Anton Admin'),
  ('10000000-0000-4000-8000-000000000005', 'Mara Manager'),
  ('10000000-0000-4000-8000-000000000006', 'Artur Audit'),
  ('10000000-0000-4000-8000-000000000007', 'Frida Fremd')
on conflict (id) do nothing;

insert into public.memberships (id, organization_id, user_id, email, role, status, employee_number, employment_start) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'employee.one@example.test', 'employee', 'active', 'N-001', '2026-01-01'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'employee.two@example.test', 'employee', 'active', 'N-002', '2026-01-01'),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'owner@example.test', 'owner', 'active', 'N-OWN', '2026-01-01'),
  ('30000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004', 'admin@example.test', 'admin', 'active', 'N-ADM', '2026-01-01'),
  ('30000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005', 'manager@example.test', 'manager', 'active', 'N-MGR', '2026-01-01'),
  ('30000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006', 'auditor@example.test', 'auditor', 'active', 'N-AUD', '2026-01-01'),
  ('30000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000007', 'foreign.employee@example.test', 'employee', 'active', 'S-001', '2026-01-01')
on conflict (organization_id, id) do nothing;

insert into public.locations (id, organization_id, name) values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Standort Nord')
on conflict (organization_id, id) do nothing;

insert into public.teams (id, organization_id, location_id, name) values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Fruehschicht')
on conflict (organization_id, id) do nothing;

insert into public.team_members (organization_id, team_id, membership_id, valid_from) values
  ('20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '2026-01-01')
on conflict do nothing;

insert into public.manager_scopes (id, organization_id, manager_membership_id, scope_type, team_id) values
  ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000005', 'team', '50000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;

insert into public.work_sessions (id, organization_id, membership_id, work_date, started_at, ended_at, source, version) values
  ('70000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '2026-07-15', '2026-07-15T06:00:00Z', '2026-07-15T14:00:00Z', 'clock', 2),
  ('70000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '2026-07-15', '2026-07-15T07:00:00Z', '2026-07-15T15:00:00Z', 'clock', 2),
  ('70000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000007', '2026-07-15', '2026-07-15T08:00:00Z', '2026-07-15T16:00:00Z', 'clock', 2),
  ('70000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '2026-07-14', '2026-07-14T06:00:00Z', '2026-07-14T14:00:00Z', 'clock', 2)
on conflict (organization_id, id) do nothing;

insert into public.clock_events (id, organization_id, work_session_id, membership_id, event_type, occurred_at, recorded_at, request_id) values
  ('80000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'clock_in', '2026-07-15T06:00:00Z', '2026-07-15T06:00:00Z', '90000000-0000-4000-8000-000000000001'),
  ('80000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'clock_in', '2026-07-15T07:00:00Z', '2026-07-15T07:00:00Z', '90000000-0000-4000-8000-000000000002')
on conflict (organization_id, request_id) do nothing;

insert into public.correction_requests (
  id,
  organization_id,
  requester_membership_id,
  work_session_id,
  original_values,
  proposed_values,
  reason,
  status,
  created_at,
  expected_session_version
) values
  ('a0000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '{"workDate":"2026-07-15","startedAt":"2026-07-15T06:00:00.000Z","endedAt":"2026-07-15T14:00:00.000Z","breakMinutes":0}', '{"workDate":"2026-07-15","startedAt":"2026-07-15T06:15:00.000Z","endedAt":"2026-07-15T14:00:00.000Z","breakMinutes":30}', 'Fiktive Korrektur fuer lokalen Test.', 'pending', '2026-07-15T16:00:00Z', 2),
  ('a0000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000004', '{"workDate":"2026-07-14","startedAt":"2026-07-14T06:00:00.000Z","endedAt":"2026-07-14T14:00:00.000Z","breakMinutes":0}', '{"workDate":"2026-07-14","startedAt":"2026-07-14T06:30:00.000Z","endedAt":"2026-07-14T14:00:00.000Z","breakMinutes":15}', 'Fiktive Korrektur fuer Owner-Test.', 'pending', '2026-07-14T16:00:00Z', 2)
on conflict (organization_id, id) do nothing;

insert into public.audit_events (id, organization_id, actor_user_id, actor_membership_id, action, entity_type, entity_id, occurred_at, request_id, metadata) values
  ('b0000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', 'seed.created', 'work_session', '70000000-0000-4000-8000-000000000001', '2026-07-15T16:30:00Z', '90000000-0000-4000-8000-000000000003', '{"localOnly":true}')
on conflict (id) do nothing;
