import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const storageMigration = readFileSync(
  resolve(repositoryRoot, "database/migrations/001_time_tracking_production_storage.sql"),
  "utf8",
);
const rlsMigration = readFileSync(resolve(repositoryRoot, "database/migrations/002_time_tracking_rls_policies.sql"), "utf8");

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
});
