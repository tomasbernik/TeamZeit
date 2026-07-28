import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  fileURLToPath(new URL("../../../../supabase/migrations/20260728160000_employee_administration_commands.sql", import.meta.url)),
  "utf8",
);

describe("employee administration command migration", () => {
  it("keeps privileged commands tenant-scoped, idempotent, audited, and server-only", () => {
    expect(sql).toContain("employee_administration_idempotency");
    expect(sql).toContain("user_id = actor_user_id");
    expect(sql).toContain("status = 'active'");
    expect(sql).toContain("insert into public.audit_events");
    expect(sql).toContain("revoke all on function");
    expect(sql).toContain("to service_role");
  });
});
