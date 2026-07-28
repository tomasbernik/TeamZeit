import { describe, expect, it } from "vitest";
import { PostgresReportingRepository } from "../reporting/postgres-repository.js";
import { ids, requireLocalSupabase, serviceClient } from "./supabase-local.js";

const env = requireLocalSupabase();
describe("reporting PostgreSQL scope", () => {
  it("returns all tenant rows for an admin and only effective scope rows for a manager", async () => {
    const repository = new PostgresReportingRepository(serviceClient(env));
    const admin = await repository.monthlyAttendance({
      organizationId: ids.orgNorth, membershipId: ids.adminMembership, userId: ids.adminUser, role: "admin",
    }, "2026-07");
    const manager = await repository.monthlyAttendance({
      organizationId: ids.orgNorth, membershipId: ids.managerMembership, userId: ids.managerUser, role: "manager",
    }, "2026-07");

    expect(admin.rows.map((row) => row.membershipId)).toEqual(expect.arrayContaining([ids.employeeOneMembership, ids.employeeTwoMembership]));
    expect(manager.rows.map((row) => row.membershipId)).toEqual([ids.employeeOneMembership]);
    expect(manager.totals.workedMinutes).toBe(960);
  });

  it("rejects an employee actor even through the server-only RPC", async () => {
    const repository = new PostgresReportingRepository(serviceClient(env));
    await expect(repository.monthlyAttendance({
      organizationId: ids.orgNorth, membershipId: ids.employeeOneMembership, userId: ids.employeeOneUser, role: "employee",
    }, "2026-07")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
