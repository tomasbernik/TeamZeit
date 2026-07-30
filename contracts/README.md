# Shared contracts

This directory is the stable boundary shared by clients and services.

- `src/*.ts` contains transport-safe TypeScript types only.
- `openapi.yaml` is the normative HTTP contract.
- `src/openapi.generated.ts` is generated from OpenAPI; do not edit it manually.
- `pnpm --filter @teamzeit/contracts generate:openapi` refreshes generated types after an intentional contract change.
- `pnpm --filter @teamzeit/contracts check:openapi` fails when generated types are stale or public DTOs are incompatible with their OpenAPI schemas.
- No file in this directory may import UI, Supabase client, database row, or feature implementation types.
- Domain/database models map explicitly to DTOs; they are not exposed accidentally.
- Additive fields should normally be optional until every consumer supports them.
- Breaking changes require a new API version or a coordinated migration.
