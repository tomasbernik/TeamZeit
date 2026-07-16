# TeamZeit

TeamZeit is a mobile-first, multi-tenant foundation for workforce time tracking. This repository currently contains the runnable application shell, shared API contracts, and the reference database design. Functional attendance and HR modules are not implemented yet.

## Prerequisites

- Node.js 22 or newer
- pnpm 11 (Corepack can provide it)
- Optional: a Supabase project for testing authentication connectivity

No production migration is applied by the commands in this README.

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
- login placeholder: `http://127.0.0.1:5173/login`
- API health: `http://127.0.0.1:3000/health`
- versioned API root: `http://127.0.0.1:3000/api/v1`

The application starts without Supabase credentials. In that state the login controls are disabled and the API health response reports `supabaseConfigured: false`.

## Environment configuration

Copy `.env.example` to `.env` and replace placeholder values only in the ignored `.env` file:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-anon-key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-publishable-anon-key
```

Only variables prefixed with `VITE_` are exposed to browser code. Never put a Supabase service-role key in a `VITE_` variable or commit it to Git. The backend foundation also uses the publishable/anon key and forwards a user's access token when an authenticated Supabase client is created later.

## Commands

```powershell
pnpm dev          # run web and API in watch mode
pnpm dev:web      # run only the Vite web app
pnpm dev:api      # run only the Fastify API
pnpm lint         # lint all workspaces
pnpm typecheck    # TypeScript checks without emitting output
pnpm test         # automated tests
pnpm build        # production builds
pnpm check        # lint, typecheck, tests, and build
```

## Repository structure

```text
apps/web/          React/Vite application shell and placeholder pages
services/api/      Fastify API runtime and server-side Supabase factory
contracts/         shared transport-safe TypeScript DTOs and OpenAPI contract
database/          reference PostgreSQL model; not an applied migration
docs/              module, database, and authorisation documentation
```

## Supabase and database status

- Supabase Auth/PostgreSQL/Storage is the selected platform.
- Client factories exist in the web and API workspaces.
- There are no real credentials, users, organisations, or employee records in the repository.
- `database/schema.sql` remains a reference model only.
- Do not run it against production. Before the first shared deployment it must be reviewed, split into ordered migrations, and covered by RLS integration tests.

## Implemented in this foundation

- responsive application layout;
- installable PWA manifest and minimal application-shell service worker;
- placeholder routes for Login, Today, Attendance, Absences, Employees, and Settings;
- environment-based configuration;
- optional Supabase client initialisation;
- API health and version root endpoints;
- workspace build, lint, type-check, and test commands.

## Not implemented yet

- real authentication screens and protected routing;
- tenant selection and membership resolution;
- attendance commands from `contracts/openapi.yaml`;
- absence, employee, scheduling, document, approval, reporting, and settings logic;
- applied database migrations, RLS test harness, file storage, notifications, and exports;
- production deployment and monitoring.

Read `ARCHITECTURE.md` and `AGENTS.md` before implementing a module.
