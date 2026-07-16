# Authentication and authorisation

## Authentication

- Supabase Auth is the identity provider.
- Initial login methods: email magic link/OTP and Google OAuth.
- The API validates the access token and derives `user_id` from it. A client-supplied user ID is never authoritative.
- An authenticated user without an active membership may only access onboarding/invitation endpoints.
- Deactivated memberships lose organisation access immediately, regardless of token lifetime.
- Sensitive actions should require a recently authenticated session when the identity provider supports it.

## Tenant context

Every organisation request includes `X-Organization-Id`. The API verifies an active membership for `(auth.user_id, organization_id)`. Database policies independently make the same check through `is_active_member`.

The organisation ID in a URL, header, body, or token claim is only a selector. It does not grant access.

## Roles

| Role | Purpose |
|---|---|
| `owner` | legal/technical tenant owner; full organisation administration |
| `admin` | member, structure, policy, and operational administration |
| `manager` | manages assigned locations/teams and their employees |
| `employee` | self-service access to own records |
| `auditor` | read-only access to authorised attendance and audit reports |

An owner is not necessarily an employee. A user has one role per organisation membership in MVP. More granular capabilities may be added later without changing record ownership.

## Capability matrix

| Action | Employee | Manager | Admin | Owner | Auditor |
|---|---:|---:|---:|---:|---:|
| View/update own profile | Yes | Yes | Yes | Yes | Yes |
| Clock own attendance | Yes | Yes | Yes | Yes* | No |
| View own attendance | Yes | Yes | Yes | Yes* | If scoped |
| Request own correction | Yes | Yes | Yes | Yes* | No |
| View scoped employee attendance | No | Yes | Yes | Yes | Yes |
| Approve scoped correction | No | Yes** | Yes | Yes | No |
| Close month | No | Scoped | Yes | Yes | No |
| Invite/deactivate employees | No | No | Yes | Yes | No |
| Assign admin/owner role | No | No | No | Yes | No |
| View audit log | Own events only | Scoped | Yes | Yes | Yes |

\* Only if the owner also has an employee profile/work policy.

\** A manager may never approve their own request.

## Manager scope

- Managers receive explicit scope records for a location or team.
- Scope is evaluated at the effective date of the target record when historical structure is available.
- Managers cannot gain access merely by editing a request body or assigning an employee to a team.
- Admin and owner are organisation-wide; auditor scope may be organisation-wide or explicit in a future extension.

## Attendance rules

- Employees can create clock events only for themselves.
- The API uses server time for authoritative live clock events.
- Employees do not directly overwrite completed work sessions. They submit correction requests.
- Managers cannot silently alter sessions; approval applies a documented correction and creates an audit event.
- Closed months reject attendance mutations. Only admin/owner can reopen, with a mandatory reason and audit event.
- Records are normally archived, not hard-deleted.

## Privacy rules

- Ordinary colleagues have no general access to other employees' attendance.
- Team availability views expose only the minimum status needed, for example `present` or `absent`; they do not expose sickness diagnosis, document contents, or private notes.
- Medical/sickness attachments are accessible only to the employee and explicitly authorised HR/admin roles, not ordinary managers unless policy and law permit it.
- Export endpoints apply the same scope as interactive reads.

## Database enforcement

- RLS is enabled on all tenant/business tables.
- Policies start from deny-by-default.
- Membership helper functions are `security definer`, have a fixed `search_path`, and return only boolean/role facts.
- Application users cannot update or delete `audit_events`.
- Service-role use is restricted to server code and scheduled jobs; handlers must still perform explicit authorisation.

## Required security tests

For every tenant resource, test:

1. anonymous access denied;
2. inactive membership denied;
3. active employee can access permitted own record;
4. employee cannot access colleague record;
5. manager can access an in-scope employee;
6. manager cannot access an out-of-scope employee;
7. same user cannot cross to another organisation without membership;
8. admin/owner capability behaves as documented;
9. auditor cannot mutate;
10. closed-period mutation is denied.
