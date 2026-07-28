import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const supabaseSql = readFileSync(
  fileURLToPath(new URL("../../../../supabase/migrations/20260728210000_identity_bootstrap_organization.sql", import.meta.url)),
  "utf8",
);
const canonicalSql = readFileSync(
  fileURLToPath(new URL("../../../../database/migrations/20260728210000_identity_bootstrap_organization.sql", import.meta.url)),
  "utf8",
);

describe("identity organisation bootstrap migration", () => {
  it("is atomic, audited, server-only, and aligned with the canonical migration", () => {
    expect(supabaseSql).toBe(canonicalSql);
    expect(supabaseSql).toContain("from auth.users");
    expect(supabaseSql).toContain("insert into public.organizations");
    expect(supabaseSql).toContain("insert into public.memberships");
    expect(supabaseSql).toContain("insert into public.audit_events");
    expect(supabaseSql).toContain("'organization.bootstrapped'");
    expect(supabaseSql).toContain("security definer");
    expect(supabaseSql).toContain("revoke all on function");
    expect(supabaseSql).toContain("to service_role");
  });
});
