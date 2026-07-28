import { describe, expect, it } from "vitest";
import { reportCsv } from "./api";

describe("reportCsv", () => {
  it("creates an Excel-friendly, escaped German CSV", () => {
    const csv = reportCsv({
      organizationId: "20000000-0000-4000-8000-000000000001",
      month: "2026-07",
      rows: [{ membershipId: "30000000-0000-4000-8000-000000000001", email: "name@example.test", workedMinutes: 480, sessionCount: 1, daysWorked: 1, openSessionCount: 0 }],
      totals: { workedMinutes: 480, sessionCount: 1, daysWorked: 1, openSessionCount: 0 },
    });
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("\"name@example.test\";\"480\";\"1\";\"1\";\"0\"");
  });
});
