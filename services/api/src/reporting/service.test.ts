import { describe, expect, it } from "vitest";
import { InMemoryReportingRepository } from "./memory-repository.js";
import { ReportingService } from "./service.js";

const actor = { organizationId: "20000000-0000-4000-8000-000000000001", membershipId: "30000000-0000-4000-8000-000000000001", userId: "10000000-0000-4000-8000-000000000001" };
describe("ReportingService", () => {
  it("returns an empty scoped report", async () => {
    await expect(new ReportingService(new InMemoryReportingRepository()).monthlyAttendance({ ...actor, role: "admin" }, "2026-07")).resolves.toMatchObject({ month: "2026-07", rows: [] });
  });
  it("denies employees", () => {
    expect(() => new ReportingService(new InMemoryReportingRepository()).monthlyAttendance({ ...actor, role: "employee" }, "2026-07")).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });
});
