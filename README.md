# TeamZeit

TeamZeit is a mobile-first, multi-tenant workforce time-tracking application. The repository contains authenticated employee and administrator flows, shared API contracts, and tenant-isolated PostgreSQL storage for attendance, employee administration, work rules, and month closing.

## Prerequisites

- Node.js 22 or newer
- pnpm 11 (Corepack can provide it)
- Optional: a Supabase project for testing authentication connectivity

No production migration is applied by the commands in this README.

For the first shared staging deployment, follow
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). The repository includes a Render
Blueprint, but deployment still requires separately created Supabase and Render
accounts and their secret environment values.

## First local start

From the repository root:

```powershell
corepack enable
pnpm install
Copy-Item .env.example .env
pnpm dev
```

Open:

- web application: `http://127.0.0.1:5173`
- login: `http://127.0.0.1:5173/login`
- API health: `http://127.0.0.1:3000/health`
- versioned API root: `http://127.0.0.1:3000/api/v1`

The application starts without Supabase credentials. In that state the login controls are disabled and the API health response reports `supabaseConfigured: false`.

## Environment configuration

Copy `.env.example` to `.env` and replace placeholder values only in the ignored `.env` file:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Only variables prefixed with `VITE_` are exposed to browser code. Never put a Supabase secret/service-role key in a `VITE_` variable or commit it to Git. The legacy `SUPABASE_ANON_KEY`, `VITE_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` names are still supported for older local setups.

## Commands

```powershell
pnpm dev          # run web and API in watch mode
pnpm dev:web      # run only the Vite web app
pnpm dev:api      # run only the Fastify API
pnpm db:local:reset      # reset local Supabase DB, apply migrations, and seed test data
pnpm db:migrations:apply # apply pending local Supabase migrations
pnpm lint         # lint all workspaces
pnpm typecheck    # TypeScript checks without emitting output
pnpm test         # automated tests
pnpm test:integration # Supabase/PostgreSQL integration and RLS tests
pnpm test:e2e     # browser E2E against local Supabase (reset DB first)
pnpm build        # production builds
pnpm check        # lint, typecheck, tests, and build
```

## Local Supabase/PostgreSQL

The local database setup is for development and integration tests only. Do not point these commands at a production Supabase project.

Requirements:

- Docker running locally
- Supabase CLI available as `supabase`

Start the local stack:

```powershell
supabase start
```

Reset the database, apply the committed migrations from `supabase/migrations`, and load fictional seed data from `supabase/seed.sql`:

```powershell
pnpm db:local:reset
```

Apply pending migrations without resetting data:

```powershell
pnpm db:migrations:apply
```

Copy `.env.example` to `.env` and fill only local values from `supabase status -o env`.

The integration harness accepts the current CLI names directly:

```dotenv
API_URL=http://127.0.0.1:54321
PUBLISHABLE_KEY=copy-from-supabase-status
SECRET_KEY=copy-from-supabase-status
JWT_SECRET=copy-from-supabase-status
TIME_TRACKING_REPOSITORY=postgres
```

For running the API/web app from the same `.env`, prefer the TeamZeit names:

```dotenv
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_PUBLISHABLE_KEY=copy-from-PUBLISHABLE_KEY
SUPABASE_SECRET_KEY=copy-from-SECRET_KEY
SUPABASE_JWT_SECRET=copy-from-JWT_SECRET
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=copy-from-PUBLISHABLE_KEY
TIME_TRACKING_REPOSITORY=postgres
```

Older `ANON_KEY`/`SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` variables continue to work. `JWT_SECRET` or `SUPABASE_JWT_SECRET` is required only for local integration tests because they sign short-lived fictional test JWTs for RLS checks.

Run the integration/RLS tests after the reset:

```powershell
pnpm test:integration
```

Run the employee browser flow against the clean local stack:

```powershell
pnpm db:local:reset
pnpm test:e2e
```

The E2E test signs in through the local OTP email captured by Mailpit, then verifies clock-in, a break represented by two work intervals, final clock-out, and the daily summary. It uses only fictional seeded users.

The seed data uses only fictional `example.test` users and fictional organisations. The service-role key is server/test-only and must never be placed in a `VITE_` variable.

## Repository structure

```text
apps/web/          React/Vite PWA for employee attendance and administration
services/api/      Fastify API, domain services, and PostgreSQL repositories
contracts/         shared transport-safe TypeScript DTOs and OpenAPI contract
database/          reference PostgreSQL model and canonical migration copies
supabase/          locally applied migrations and fictional development seed
docs/              module, database, and authorisation documentation
```

## Supabase and database status

- Supabase Auth/PostgreSQL/Storage is the selected platform.
- Client factories exist in the web and API workspaces.
- There are no real credentials, users, organisations, or employee records in the repository.
- `database/schema.sql` remains the reference model. Local Supabase applies the matching initial schema plus ordered migrations from `supabase/migrations`.
- Do not run these migrations against production without a reviewed rollout plan.

## Implemented

- responsive application layout;
- installable PWA manifest and minimal application-shell service worker;
- authenticated email OTP and Google login with protected routing and organisation selection;
- functional Today dashboard for clock-in, breaks, and clock-out;
- attendance day/month overviews with direct creation, editing, and archiving of own work intervals;
- organisation-local daily calculations, planned minutes, balance, holidays, and missing-clock-out state;
- employee administration and effective-dated work rules;
- month status, closing, and reopening commands with attendance mutation guards;
- PostgreSQL repositories and migrations for the implemented MVP modules;
- unit, migration, PostgreSQL integration, and employee attendance E2E tests;
- placeholder routes for Absences and Settings;
- environment-based configuration;
- optional Supabase client initialisation;
- API health and version root endpoints;
- workspace build, lint, type-check, and test commands.

## Not implemented yet

- organisation structure and manager-scope enforcement;
- absence, scheduling, document, reporting, and settings logic;
- invitation email delivery (the current administration flow records that delivery was requested);
- file storage, notifications, and exports;
- production-ready RLS coverage for every role/resource combination;
- production deployment and monitoring.

Read `ARCHITECTURE.md` and `AGENTS.md` before implementing a module.
