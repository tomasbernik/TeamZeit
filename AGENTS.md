# TeamZeit collaboration rules

These rules keep parallel work mergeable and preserve module boundaries.

## Before starting

1. Read `ARCHITECTURE.md`, `docs/MODULES.md`, and `docs/AUTHORIZATION.md`.
2. State the module you own and the files you intend to change.
3. Check the working tree and preserve unrelated work.
4. Do not implement a neighbouring module as a shortcut.

## Ownership

- Each task must have one primary module from `docs/MODULES.md`.
- A module owns its implementation, migrations for its tables, tests, and API handlers.
- `contracts/`, authentication primitives, organisation membership, and global database helpers are shared architecture surfaces. Coordinate changes to them before editing.
- Never redefine shared DTOs locally inside a feature.

## Change boundaries

- Prefer additive contract changes.
- Breaking API or shared-type changes require a version/migration note and updates to all known consumers.
- Do not edit another module's tables directly from feature code; call its public application service or use a documented event.
- New tenant tables must include `organization_id`, RLS, tenant-safe indexes, and RLS tests.
- New privileged commands must create an audit event.

## Database migrations

- Use new timestamped migration files once migrations are introduced; never rewrite an already-applied migration.
- Table and enum names use `snake_case`; TypeScript names use `camelCase`/`PascalCase`.
- Foreign keys, unique constraints, and indexes must include tenant boundaries where applicable.
- Destructive migrations require an explicit rollout and rollback plan.

## Definition of done

- Contract and implementation agree.
- Permission checks exist at API and RLS layers.
- Tests cover allowed access and denied cross-tenant access.
- User-facing strings are ready for German localisation and are not embedded in domain logic.
- Documentation is updated when a public contract or architectural rule changes.

## Files that should rarely conflict

Agents should normally work in their module directories. Changes to these shared files should be isolated in small commits/tasks:

- `ARCHITECTURE.md`
- `database/schema.sql` or global migration helpers
- `contracts/src/common.ts`
- `contracts/openapi.yaml`
- authentication/session middleware
