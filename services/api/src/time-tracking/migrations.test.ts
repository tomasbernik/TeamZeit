import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const storageMigration = readFileSync(
  resolve(repositoryRoot, "database/migrations/001_time_tracking_production_storage.sql"),
  "utf8",
);
const rlsMigration = readFileSync(resolve(repositoryRoot, "database/migrations/002_time_tracking_rls_policies.sql"), "utf8");
const rolePrivilegesMigration = readFileSync(
  resolve(repositoryRoot, "database/migrations/20260717090000_time_tracking_role_privileges.sql"),
  "utf8",
);
const supabaseInitialMigration = readFileSync(
  resolve(repositoryRoot, "supabase/migrations/20260716000000_initial_schema.sql"),
  "utf8",
);
const supabaseStorageMigration = readFileSync(
  resolve(repositoryRoot, "supabase/migrations/20260716000100_time_tracking_production_storage.sql"),
  "utf8",
);
const supabaseRlsMigration = readFileSync(
  resolve(repositoryRoot, "supabase/migrations/20260716000200_time_tracking_rls_policies.sql"),
  "utf8",
);
const supabaseRolePrivilegesMigration = readFileSync(
  resolve(repositoryRoot, "supabase/migrations/20260717090000_time_tracking_role_privileges.sql"),
  "utf8",
);

describe("time tracking database migrations", () => {
  it("persists idempotency keys with a tenant-scoped unique key", () => {
    expect(storageMigration).toContain("create table if not exists public.time_tracking_idempotency");
    expect(storageMigration).toContain("primary key (organization_id, membership_id, request_id)");
    expect(storageMigration).toContain("time_tracking_idempotency_membership_fk");
    expect(storageMigration).toContain("time_tracking_apply_operations");
  });

  it("keeps clock and audit history append-only", () => {
    expect(storageMigration).toContain("clock_events_append_only");
    expect(storageMigration).toContain("audit_events_append_only");
    expect(storageMigration).toContain("append_only_history");
  });

  it("defines scoped RLS helpers and policies for attendance reads", () => {
    expect(rlsMigration).toContain("is_attendance_manager_for");
    expect(rlsMigration).toContain("can_read_attendance");
    expect(rlsMigration).toContain("membership_id = public.current_membership_id(organization_id)");
    expect(rlsMigration).toContain("work_sessions_scoped_read");
    expect(rlsMigration).toContain("array['owner','admin','auditor']");
    expect(rlsMigration).toContain("manager.role = 'manager'");
  });

  it("grants SQL privileges without replacing RLS decisions", () => {
    expect(rolePrivilegesMigration).toContain("grant usage on schema public to authenticated, service_role");
    expect(rolePrivilegesMigration).toContain("grant select on table");
    expect(rolePrivilegesMigration).toContain("public.work_sessions");
    expect(rolePrivilegesMigration).toContain("to authenticated");
    expect(rolePrivilegesMigration).not.toContain("to anon, authenticated");
    expect(rolePrivilegesMigration).toContain("grant insert on table public.work_sessions to authenticated");
    expect(rolePrivilegesMigration).toContain("revoke execute on function public.time_tracking_apply_operations(jsonb) from public");
    expect(rolePrivilegesMigration).toContain("grant execute on function public.can_read_attendance(uuid, uuid, date) to authenticated");
    expect(rolePrivilegesMigration).toContain("grant execute on function public.time_tracking_apply_operations(jsonb) to service_role");
    expect(rolePrivilegesMigration).toContain("grant usage on type");
    expect(rolePrivilegesMigration).not.toContain("grant all");
  });

  it("keeps Supabase local migrations aligned with database sources", () => {
    expect(supabaseInitialMigration).toBe(readFileSync(resolve(repositoryRoot, "database/schema.sql"), "utf8"));
    expect(supabaseStorageMigration).toBe(storageMigration);
    expect(supabaseRlsMigration).toBe(rlsMigration);
    expect(supabaseRolePrivilegesMigration).toBe(rolePrivilegesMigration);
  });
});
