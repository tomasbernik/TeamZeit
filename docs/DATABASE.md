# Database model

`database/schema.sql` is the executable reference model. It must be split into ordered migrations before the first shared environment is deployed.

## Core relationships

```mermaid
erDiagram
  AUTH_USER ||--o| PROFILE : has
  AUTH_USER ||--o{ MEMBERSHIP : holds
  ORGANIZATION ||--o{ MEMBERSHIP : contains
  ORGANIZATION ||--o{ INVITATION : issues
  ORGANIZATION ||--o{ LOCATION : has
  LOCATION ||--o{ TEAM : contains
  TEAM ||--o{ TEAM_MEMBER : assigns
  MEMBERSHIP ||--o{ TEAM_MEMBER : belongs
  MEMBERSHIP ||--o{ MANAGER_SCOPE : receives
  MEMBERSHIP ||--o{ WORK_SESSION : records
  WORK_SESSION ||--o{ WORK_BREAK : contains
  WORK_SESSION ||--o{ CLOCK_EVENT : evidenced_by
  WORK_SESSION ||--o{ CORRECTION_REQUEST : corrected_by
  MEMBERSHIP ||--o{ MONTH_CLOSURE : closes
  ORGANIZATION ||--o{ AUDIT_EVENT : logs
```

## Ownership rules

- `profiles` is global identity display data and is keyed by the Auth user ID.
- `memberships` connects a user to an organisation and carries their role and employment settings.
- All operational data is tenant-owned through `organization_id`.
- Composite foreign keys ensure a child and parent belong to the same organisation.
- Invitations store only a hash of the bearer token. Raw invitation tokens must not be persisted.

## Attendance model

- `work_sessions` is the current approved representation of a period of work.
- `work_breaks` contains zero or more break intervals.
- `clock_events` is append-only evidence of live user actions and supports idempotent retries through `request_id`.
- `correction_requests` captures immutable original and proposed values. Approval updates the work session in the same transaction and writes an audit event.
- Partial unique indexes allow only one open work session per member and one open break per session.
- `month_closures` records closing and explicit reopening instead of deleting the close record.

## Invariants enforced outside simple constraints

The command transaction and its database function/tests must enforce:

- no overlapping work sessions for the same membership;
- breaks remain within their work session;
- clock state transitions occur in the correct order;
- `work_date` matches the organisation-local date rule;
- mutations are rejected for closed periods;
- a correction reviewer is authorised and is not the requester;
- the approved session version still matches the correction's expected base version;
- manager access is limited to effective team/location scope.

## Deletion and retention

- Organisations and operational records are not hard-deleted through product APIs.
- Employees and structure records are deactivated/archived.
- Audit and clock evidence are append-only.
- Exact retention and deletion schedules are a policy decision to complete before production; they must account for German employment, tax/payroll, and privacy requirements.
