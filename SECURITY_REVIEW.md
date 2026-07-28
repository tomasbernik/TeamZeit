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

Status: fixed.

`resolveCurrentContext` now returns only active memberships, so a deactivated user no longer receives organisation metadata through `/api/v1/me`.

### M-002: Manager-scoped read RLS is not implemented yet

Status: fixed.

Scope-aware policies cover attendance and organisation structure reads. The final effective-scope migration ensures both the employee assignment and manager scope are valid on the attendance date. PostgreSQL integration tests cover in-scope, out-of-scope, expired-scope, inactive, cross-tenant, administrator, owner, auditor, and employee access.

### M-003: Time tracking date ranges are syntactically validated but unbounded

Status: fixed.

`/attendance/sessions?from=&to=` rejects reversed ranges and ranges longer than 366 days. The OpenAPI contract documents the same boundary.

### M-004: Contract compatibility is manual

Status: not changed.

OpenAPI and TypeScript contracts largely agree for reviewed time tracking shapes, headers, and error envelopes. There is no automated OpenAPI-to-TypeScript compatibility gate, so drift can enter unnoticed.

Recommendation: add a contract compatibility check in CI once contract generation or schema validation tooling is selected.

## Low

### L-001: Service worker intercepts all same-origin GET requests

Status: fixed.

The service worker explicitly bypasses `/api/`; API responses are never handled by its offline fallback.

### L-002: No direct RLS regression harness yet

Status: fixed for implemented MVP resources.

The local Supabase integration suite directly exercises PostgreSQL policies for anonymous, inactive, employee-own, employee-colleague, manager in-scope and out-of-scope, expired scope, cross-organization, administrator/owner, auditor, immutable audit/clock evidence, and closed-period behavior.

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
