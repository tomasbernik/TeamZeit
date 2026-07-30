# Integration notes

## Implemented MVP integration

The Fastify API resolves an authenticated active membership and passes that context into module-local services.
The web application consumes the shared DTOs from `contracts/src`, while `contracts/openapi.yaml` defines the
versioned HTTP surface.

### Time Tracking

`services/api/src/time-tracking` implements live clock commands, current/daily/monthly views, direct employee
interval creation/update/archive, idempotency, invalid-transition checks, organisation-local date calculations,
planned-time and balance calculations, clock evidence, and audit events. PostgreSQL is used when
`TIME_TRACKING_REPOSITORY=postgres`; the in-memory repository supports isolated tests and UI development.

`work_sessions` is the active interval model. Breaks are derived from gaps between intervals. Existing
`work_breaks` and `correction_requests` remain historical; new employee corrections are immediate interval
mutations and produce immutable audit events.

### Identity and employee administration

`services/api/src/identity` provides current membership context and administrator/owner employee commands.
Employee work rules are effective-dated and provide weekday target minutes plus the minimum break threshold.
Role assignment remains constrained by `docs/AUTHORIZATION.md`; owner assignment is not delegated to admins.
Invitation delivery uses the server-side Supabase Auth administration API and the configured `WEB_ORIGIN` redirect.
After successful delivery, an audited database command links the Auth user to the invited membership. The first
successful sign-in activates invited memberships and records a separate audit event. Production delivery requires
custom SMTP configuration in Supabase.

### Month Closing

`services/api/src/month-closing` provides month status, close, and reopen commands. Time Tracking calls the
module's period guard before interval mutations. Reopening is privileged, requires a reason, and is audited.

### Organisation Structure and manager scope

`services/api/src/organisation-structure` implements locations, teams, effective-dated employee assignments,
and manager scopes. Attendance and organisation-structure reads enforce the effective scope for the target date
at both the API and PostgreSQL/RLS layers. PostgreSQL integration tests cover in-scope and out-of-scope manager
behaviour; the browser suite covers access to the administrator organisation-structure sections.

### Basic attendance reporting

`services/api/src/reporting` provides scope-aware monthly attendance summaries and CSV export. Reports reuse the
same tenant and effective manager-scope boundaries as interactive attendance reads; reporting never broadens a
caller's access to source attendance records.

### Absence

`services/api/src/absence` implements employee absence request/list/cancel and scoped manager/admin review.
Commands are idempotent and audited. PostgreSQL RLS permits own, tenant-privileged, and effective manager-scope
reads; authenticated clients cannot mutate absence tables directly. Leave balances and attachments are deferred.

### Database and verification

Canonical migration copies live in both `database/migrations` and `supabase/migrations`; keep matching files
byte-equivalent. Local Supabase applies the `supabase` copies and fictional seed data. Run `pnpm check` for the
workspace and, with local Supabase running and configured, `pnpm test:integration` followed by `pnpm test:e2e`.

Manager-scoped attendance and RLS policies are part of the current MVP surface. New manager-facing features must
reuse these effective-scope rules and add denied out-of-scope and cross-tenant regression tests.
