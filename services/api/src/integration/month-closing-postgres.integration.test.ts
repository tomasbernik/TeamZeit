import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PostgresMonthClosingRepository } from "../month-closing/postgres-repository.js";
import { PostgresPeriodGuard } from "../time-tracking/postgres-repository.js";
import { ids, requireLocalSupabase, serviceClient, userClient } from "./supabase-local.js";
const env = requireLocalSupabase();
describe("Supabase/PostgreSQL month closing integration", () => {
  it("atomically closes, audits, blocks intervals, and reopens a month", async () => {
    const db = serviceClient(env); const repository = new PostgresMonthClosingRepository(db); const guard = new PostgresPeriodGuard(db);
    const base = { organizationId: ids.orgNorth, membershipId: ids.adminMembership, userId: ids.adminUser, targetMembershipId: ids.employeeTwoMembership, monthStart: "2026-09-01", occurredAt: "2026-10-01T08:00:00.000Z" };
    const closeKey = randomUUID(); const closed = await repository.close({ ...base, reason: "Payroll export prepared", requestId: closeKey });
    const duplicate = await repository.close({ ...base, reason: "Payroll export prepared", requestId: closeKey });
    await expect(guard.assertPeriodOpen({ organizationId: ids.orgNorth, membershipId: ids.employeeTwoMembership, workDate: "2026-09-15", operation: "manual" })).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
    const auditAfterClose = await db.from("audit_events").select("action, metadata").eq("request_id", closeKey);
    expect(duplicate).toEqual(closed); expect(auditAfterClose.data).toHaveLength(1); expect(auditAfterClose.data?.[0]).toMatchObject({ action: "month_closure.closed", metadata: { reason: "Payroll export prepared" } });
    const reopened = await repository.reopen({ ...base, occurredAt: "2026-10-01T09:00:00.000Z", reason: "Missing employee interval", requestId: randomUUID() });
    await expect(guard.assertPeriodOpen({ organizationId: ids.orgNorth, membershipId: ids.employeeTwoMembership, workDate: "2026-09-15", operation: "manual" })).resolves.toBeUndefined(); expect(reopened.status).toBe("open");
  });
  it("denies direct writes and limits employee reads to their own closures", async () => {
    const employee = userClient(env, ids.employeeOneUser);
    const write = await employee.from("month_closures").insert({ organization_id: ids.orgNorth, membership_id: ids.employeeOneMembership, month_start: "2026-10-01", closed_by_membership_id: ids.adminMembership, reason: "Forbidden direct write" });
    const colleagueRead = await employee.from("month_closures").select("id").eq("organization_id", ids.orgNorth).eq("membership_id", ids.employeeTwoMembership);
    expect(write.error).not.toBeNull(); expect(colleagueRead.error).toBeNull(); expect(colleagueRead.data).toEqual([]);
  });
  it("rejects a non-admin actor at the database boundary", async () => {
    const repository = new PostgresMonthClosingRepository(serviceClient(env));
    await expect(repository.close({ organizationId: ids.orgNorth, membershipId: ids.employeeOneMembership, userId: ids.employeeOneUser, targetMembershipId: ids.employeeOneMembership, monthStart: "2026-10-01", occurredAt: "2026-11-01T08:00:00.000Z", reason: "Unauthorized attempt", requestId: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
