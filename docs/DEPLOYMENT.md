# TeamZeit staging deployment

This runbook describes the first shared staging deployment. It intentionally does
not load `supabase/seed.sql`, because that file creates fictional local Auth users
with a known development password.

## Target architecture

- Supabase Cloud owns PostgreSQL, Auth, and RLS. The initial TeamZeit staging
  environment shares the existing `CigApp` project to stay within the Free Plan
  active-project limit.
- Render runs the Fastify API and serves the Vite application.
- `render.yaml` is the source of truth for the two Render services.
- `supabase/migrations` is the source of truth for the remote database schema.

The shared project is a staging-only cost trade-off. TeamZeit and CigApp keep
separate tables and RLS policies, but share Auth, quotas, availability, and the
database lifecycle. Do not connect Render preview deployments to this database.
A production TeamZeit environment must use a dedicated Supabase project.

## 1. Pre-deployment gate

Deploy only a reviewed commit. From the repository root run:

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

Before the first deployment also start local Supabase, reset it, and run the
PostgreSQL/RLS and browser suites:

```powershell
supabase start
pnpm db:local:reset
pnpm test:integration
pnpm test:e2e
```

Do not deploy if a migration, RLS, or cross-tenant test fails.

## 2. Create and migrate Supabase staging

For the initial staging deployment, link the confirmed existing `CigApp` project.
Keep its database password and server secret outside Git.

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase migration list
npx supabase db dump --linked --schema public --file .supabase/backups/pre-teamzeit-schema.sql
npx supabase db dump --linked --schema public --data-only --use-copy --file .supabase/backups/pre-teamzeit-data.sql
npx supabase db push --linked --dry-run
npx supabase db push
```

Do not use `--include-seed` against staging or production. After the push, verify
in the Supabase dashboard that RLS is enabled on every tenant/business table.
Future schema changes must be new migration files and must not be made directly
in the remote Table or SQL Editor. Before every TeamZeit migration, preserve and
verify the existing CigApp tables and data. Never rename, alter, or query CigApp
tables from TeamZeit application code.

## 3. Create the Render services

Connect the Git repository in Render and create a Blueprint from `render.yaml`.
The Blueprint creates:

- `teamzeit-api`, a Node web service with `/health` as its health check;
- `teamzeit-web`, a static site with a React Router rewrite to `/index.html`.

Populate the Blueprint prompts with these values:

### API service

| Variable | Value |
|---|---|
| `WEB_ORIGIN` | Final HTTPS URL of `teamzeit-web`, without a trailing slash |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Browser-safe publishable key |
| `SUPABASE_SECRET_KEY` | Server-only secret key |

### Web service

| Variable | Value |
|---|---|
| `VITE_API_URL` | Final API URL ending in `/api/v1` |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser-safe publishable key |

Never put `SUPABASE_SECRET_KEY` or a legacy service-role key in a `VITE_`
variable. Vite embeds all `VITE_` values in the public browser bundle.

Because the web and API URLs are only known after the services exist, fill both
URL variables and trigger one clean redeploy of each service.

## 4. Configure Supabase Auth

In Authentication > URL Configuration set:

- Site URL: the exact `teamzeit-web` HTTPS origin;
- Redirect URL: `https://YOUR-WEB-HOST/**`;
- retain localhost redirect URLs only if local development still needs them.

Enable only the intended login providers. For Google OAuth, configure the Google
client credentials and the Supabase callback URL shown by the dashboard.

Email OTP in TeamZeit uses `shouldCreateUser: false`. Create the initial Auth user
manually in the Supabase dashboard before attempting the first login. For a
non-demo environment, configure a custom SMTP provider; Supabase's default mail
service is not a production delivery service.

## 5. Bootstrap the first organisation owner

This is a one-time staging bootstrap. First create the Auth user in the Supabase
dashboard and copy its UUID. Then run the following transaction in the SQL Editor,
replacing every placeholder. Use a new UUID for the organisation and membership.

```sql
begin;

insert into public.profiles (id, display_name)
values ('AUTH_USER_UUID', 'DISPLAY NAME');

insert into public.organizations (id, name, slug, time_zone)
values ('ORGANIZATION_UUID', 'ORGANIZATION NAME', 'organization-slug', 'Europe/Berlin');

insert into public.memberships (
  id,
  organization_id,
  user_id,
  email,
  role,
  status,
  employment_start
)
values (
  'MEMBERSHIP_UUID',
  'ORGANIZATION_UUID',
  'AUTH_USER_UUID',
  'OWNER_EMAIL',
  'owner',
  'active',
  current_date
);

commit;
```

Run the block once. Confirm that exactly one active owner membership exists. All
later users should be created through the application's administration flow, not
through ad-hoc SQL.

## 6. Smoke test and rollback

Verify:

1. `GET https://YOUR-API-HOST/health` returns HTTP 200 and
   `supabaseConfigured: true`.
2. Opening `/login` and refreshing it does not return 404.
3. The owner receives an OTP, signs in, and sees the expected organisation.
4. Clock in/out and an attendance read work.
5. An unauthenticated API request is rejected.
6. Browser developer tools show no server secret.

For an application rollback, redeploy the last known-good Render commit. Database
migrations are forward-only: do not edit an applied migration. A database rollback
requires a new corrective migration and a reviewed rollout plan. Before real
employee data is used, enable an appropriate Supabase backup plan and verify that
restore procedures and retention meet the organisation's requirements.

## Production follow-up

Staging suitability does not imply production readiness. Before processing real
employee data, complete the full authorisation/RLS matrix, configure monitoring
and alerting, establish backup/restore ownership, review GDPR and retention
requirements, configure a custom domain and SMTP, and document incident response.
