# TeamZeit modules

The table defines ownership boundaries, not an implementation schedule.

| Module | Responsibilities | Owns data | Public surface | MVP |
|---|---|---|---|---|
| Identity & Tenancy | organisations, profiles, invitations, memberships, active tenant | `organizations`, `profiles`, `memberships`, `invitations` | current context, member administration | Yes |
| Organisation Structure | locations, teams/groups, manager scope | `locations`, `teams`, `team_members`, `manager_scopes` | structure queries and assignments | Yes |
| Time Tracking | clock events, work sessions, breaks, daily totals | `work_sessions`, `work_breaks`, `clock_events` | clock commands, own/month views | Yes |
| Corrections & Approval | correction requests, approval workflow, immutable change history | `correction_requests` | submit/review correction | Yes |
| Month Closing | lock periods and prevent later mutation | `month_closures` | close/reopen/status | Yes |
| Absence | leave balances, leave/sickness requests, attachments | future module migrations | absence request/review | Later |
| Scheduling | shifts, staffing requirements, replacements | future module migrations | schedules and coverage | Later |
| Documents | metadata, expiry dates, private files | future module migrations + storage | document lifecycle | Later |
| Reporting & Export | dashboard projections, Excel/PDF/payroll exports | projections/export jobs only | reports and exports | Basic MVP |
| Notifications | in-app/email reminders | notification deliveries/preferences | notification commands | Later |
| Audit | security and business audit trail | `audit_events` | authorised audit query | Yes |

## Module interaction examples

- Time Tracking asks Identity & Tenancy for the authenticated membership context; it does not query UI session state.
- Corrections owns the approval workflow and calls a Time Tracking application service to apply an approved correction transactionally.
- Month Closing exposes `assertPeriodOpen`. Time Tracking and Corrections call it before mutation.
- Reporting reads authorised module projections; it does not become the owner of source records.
- Scheduling may compare planned shifts to Time Tracking sessions through public read models, never by mutating attendance.

## Suggested parallel work packages

After the foundation is accepted, independent tasks can be assigned as follows:

1. Identity/Tenancy schema and session context.
2. Organisation Structure schema and manager scopes.
3. Time Tracking domain calculations and state machine.
4. API runtime skeleton plus contract validation.
5. PWA shell and design system derived from the existing `stempeln` look.
6. RLS and permission test harness.

Tasks 3 and 5 can start against shared DTOs. Database integration for all modules waits for task 1's membership context and task 6's test harness.
