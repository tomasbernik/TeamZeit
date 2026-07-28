# TeamZeit production operations

This runbook defines the minimum operational controls before real employee data
is processed. Record the responsible person and evidence date for every item.

## Service checks

- `/health` is a liveness check. It proves that the API process can answer.
- `/ready` is the deployment and alerting check. It returns `503` when the API
  cannot reach PostgreSQL through its server credentials.
- Alert after two consecutive `/ready` failures from an external HTTPS monitor.
- Alert on elevated HTTP `5xx` responses and authentication failures. Use the
  `X-Request-Id` response header to correlate a user report with API logs.
- Never include access tokens, Supabase secrets, attendance bodies, or employee
  email addresses in monitoring labels or alert messages.

## Backups and restore

Production requires a dedicated Supabase project with an enabled backup plan.
The named operations owner must record:

- backup frequency and retention;
- point-in-time recovery availability;
- who may request and perform a restore;
- the last successful restore rehearsal;
- where restore evidence is stored.

Rehearse restoration into an isolated non-production project at least quarterly.
Verify row counts, tenant isolation/RLS, Auth linkage, and a sample attendance
month. Never validate a restore by overwriting production.

## Incident response

1. Confirm impact using `/ready`, Render logs, Supabase status, and request IDs.
2. If confidentiality may be affected, stop writes or take the affected service
   offline before investigating with production data.
3. Preserve logs and an incident timeline; do not copy employee data into chat.
4. Rotate exposed credentials and invalidate sessions when relevant.
5. Restore service from the last known-good application version or use a new
   forward corrective migration. Never edit an applied migration.
6. Assess notification obligations with the organisation's privacy owner.
7. Document root cause, affected tenants, corrective actions, and follow-up tests.

## Release and rollback

Before deployment run `pnpm check`, reset local Supabase, and run integration and
browser suites. Apply migrations before starting code that depends on them.
Application rollback uses a known-good Render commit. Database changes remain
forward-only and require a corrective migration.

## Required external configuration

- dedicated production Supabase project;
- custom SMTP with verified sender domain and tested invitation delivery;
- custom HTTPS domains;
- external `/ready` monitoring and an on-call recipient;
- error/log retention appropriate for privacy requirements;
- backup plan and completed restore rehearsal.
