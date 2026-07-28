# TeamZeit modules

The table defines ownership boundaries, not an implementation schedule.

| Module | Responsibilities | Owns data | Public surface | MVP |
|---|---|---|---|---|
| Identity & Tenancy | organisations, profiles, invitations, memberships, active tenant | `organizations`, `profiles`, `memberships`, `invitations` | current context, member administration | Yes |
| Organisation Structure | locations, teams/groups, manager scope | `locations`, `teams`, `team_members`, `manager_scopes` | structure queries and assignments | Yes |
| Time Tracking | clock events, work intervals, derived breaks, direct self-service, daily totals | `work_sessions`, `clock_events`; legacy `work_breaks`/`correction_requests` are historical | clock commands, own interval CRUD, own/month views | Yes |
| Month Closing | lock periods and prevent later mutation | `month_closures` | close/reopen/status | Yes |
| Absence | leave balances, leave/sickness requests, attachments | future module migrations | absence request/review | Later |
| Scheduling | shifts, staffing requirements, replacements | future module migrations | schedules and coverage | Later |
| Documents | metadata, expiry dates, private files | future module migrations + storage | document lifecycle | Later |
| Reporting & Export | dashboard projections, Excel/PDF/payroll exports | projections/export jobs only | reports and exports | Basic MVP |
| Notifications | in-app/email reminders | notification deliveries/preferences | notification commands | Later |
| Audit | security and business audit trail | `audit_events` | authorised audit query | Yes |

## Module interaction examples

- Time Tracking asks Identity & Tenancy for the authenticated membership context; it does not query UI session state.
- Time Tracking applies validated own-interval changes immediately and emits audit events.
- Month Closing exposes `assertPeriodOpen`. Time Tracking and Corrections call it before mutation.
- Reporting reads authorised module projections; it does not become the owner of source records.
- Scheduling may compare planned shifts to Time Tracking sessions through public read models, never by mutating attendance.

## Current implementation sequence

The foundation and first employee attendance slice are implemented. Continue in this order:

1. Stabilise employee administration, work rules, direct attendance intervals, and Month Closing.
2. Complete PostgreSQL/RLS and browser verification for that slice.
3. Implement Organisation Structure and effective manager scopes.
4. Add manager attendance views only after scope-aware API and RLS enforcement.
5. Add the Basic MVP reporting/export projection.

Absence, Scheduling, Documents, and Notifications remain later modules and should not be used as shortcuts for
missing MVP behaviour.
