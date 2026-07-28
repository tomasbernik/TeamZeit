import type { MonthlyAttendanceReport } from "@teamzeit/contracts";
import type { ReportingActor, ReportingRepository } from "./types.js";

export class InMemoryReportingRepository implements ReportingRepository {
  public async monthlyAttendance(actor: ReportingActor, month: string): Promise<MonthlyAttendanceReport> {
    return {
      organizationId: actor.organizationId,
      month,
      rows: [],
      totals: { workedMinutes: 0, sessionCount: 0, daysWorked: 0, openSessionCount: 0 },
    };
  }
}
