import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
const sql = readFileSync(fileURLToPath(new URL("../../../../supabase/migrations/20260718150000_month_closing.sql", import.meta.url)), "utf8");
describe("month closing migration", () => {
  it("keeps commands server-authoritative, admin-only, audited, and tenant-readable", () => {
    expect(sql).toContain("month_closing_admin_required"); expect(sql).toContain("month_closure.closed"); expect(sql).toContain("month_closure.reopened"); expect(sql).toContain("revoke all on function"); expect(sql).toContain("membership_id=public.current_membership_id(organization_id)");
  });
});
