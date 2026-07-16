# TeamZeit Security Review

Date: 2026-07-16
Reviewer scope: authentication/session handling, tenant isolation, `X-Organization-Id` enforcement, RLS design, time tracking API, idempotency, correction review permissions, OpenAPI/TypeScript contracts, cross-organization data leakage, PWA/service worker cache.

Primary modules reviewed: Identity & Tenancy, Time Tracking, Corrections & Approval, database RLS baseline, web PWA shell.

## Critical

No critical findings remain from this review.

## High

### H-001: Idempotency results were scoped only to organization

Status: fixed.

Before this review, time tracking idempotency lookup used only `(organizationId, requestId)`. In the same organization, another membership that reused or learned an `Idempotency-Key` could receive the first member's stored clock or correction response. That response includes attendance session identifiers, membership identifiers, timestamps, and correction content.

Impact: tenant-internal data leakage and possible command suppression/replay confusion across employees.

Fix:
- `TimeTrackingRepository` now scopes idempotent results by `(organizationId, membershipId, requestId)`.
- `TimeTrackingService` passes the authenticated membership into all idempotency reads and writes.
- In-memory repository and test doubles use the widened key.
- Regression test added: same organization and same idempotency key across two memberships creates separate results.

References:
- `services/api/src/time-tracking/types.ts`
- `services/api/src/time-tracking/service.ts`
- `services/api/src/time-tracking/memory-repository.ts`
- `services/api/src/time-tracking/service.test.ts`

### H-002: Manager correction review was allowed without manager-scope enforcement

Status: fixed conservatively.

The authorization design says managers may approve only scoped employee corrections and may never approve their own requests. The route layer allowed any active `manager` membership in the organization to call the correction review endpoint, but no effective team/location scope check exists yet in the API service.

Impact: an unscoped or out-of-scope manager could approve or reject another employee's correction within the same organization.

Fix:
- Correction review route now treats only `owner` and `admin` as reviewers until scoped manager enforcement is implemented.
- Regression test added for manager review denial.

References:
- `services/api/src/time-tracking/routes.ts`
- `services/api/src/time-tracking/routes.test.ts`
- `docs/AUTHORIZATION.md`

## Medium

### M-001: `/api/v1/me` returns inactive memberships

Status: not changed.

The current context endpoint returns memberships for the authenticated user, including inactive memberships. The web client filters inactive memberships out of active tenant selection, and attendance endpoints independently require an active membership plus `X-Organization-Id`. However, `docs/AUTHORIZATION.md` says deactivated memberships lose organization access immediately, and returning organization metadata for inactive memberships weakens that rule.

Recommendation: decide whether inactive membership visibility is required for UX. If not, filter `/api/v1/me` to active memberships or return a minimal inactive marker without organization details.

### M-002: Manager-scoped read RLS is not implemented yet

Status: not changed.

The schema enables RLS on tenant tables and current policies are owner/self baseline policies. The file explicitly defers detailed manager-scope policies. That is acceptable for unshipped manager views, but manager/scoped attendance views must not ship until RLS helper functions and tests cover in-scope and out-of-scope access.

Recommendation: add scope-aware RLS helpers and required RLS tests before adding manager attendance/correction list endpoints.

### M-003: Time tracking date ranges are syntactically validated but unbounded

Status: not changed.

`/attendance/sessions?from=&to=` validates date format, but does not enforce `from <= to` or a maximum range. This is not a tenant isolation issue, but it can become an availability problem once backed by a real database.

Recommendation: enforce ordered, bounded ranges in the API contract and route validation before production use.

### M-004: Contract compatibility is manual

Status: not changed.

OpenAPI and TypeScript contracts largely agree for reviewed time tracking shapes, headers, and error envelopes. There is no automated OpenAPI-to-TypeScript compatibility gate, so drift can enter unnoticed.

Recommendation: add a contract compatibility check in CI once contract generation or schema validation tooling is selected.

## Low

### L-001: Service worker intercepts all same-origin GET requests

Status: not changed.

The service worker precaches only the app shell (`/`, manifest, icon) and does not dynamically cache API responses. Same-origin GET requests are still intercepted and use `fetch(...).catch(() => caches.match(event.request))`. This does not currently cache attendance or identity API data, but a tighter route allowlist would reduce future mistakes.

Recommendation: restrict service worker handling to navigation/app-shell assets and explicitly bypass `/api/`.

### L-002: No direct RLS regression harness yet

Status: not changed.

The schema enables RLS and avoids direct client mutation policies for attendance, approvals, closures, membership administration, and audit events. Current automated tests exercise API authorization with fakes, not database policies.

Recommendation: add database/RLS tests for anonymous, inactive, employee-own, employee-colleague, manager in-scope, manager out-of-scope, cross-organization, admin/owner, auditor, and closed-period cases before relying on Supabase RLS in production.

## Positive Findings

- Attendance endpoints require bearer authentication and `X-Organization-Id`; the server selects an active membership for that organization before invoking the service.
- `X-Organization-Id` is treated as a selector, not proof of access.
- Mutating attendance and correction endpoints require `Idempotency-Key`.
- Live clock commands use server time, not client-supplied timestamps.
- Correction submission is limited to the authenticated member's own session.
- Correction review blocks requester self-review in the domain service.
- RLS is enabled on all reviewed tenant/business tables, with tenant-bound foreign keys on attendance/correction records.
- Audit events have no direct application-user mutation policy in the reference schema.
- The PWA shell does not currently store dynamic API responses in Cache Storage.
