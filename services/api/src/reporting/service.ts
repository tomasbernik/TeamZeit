import type { MonthlyAttendanceReport } from "@teamzeit/contracts";
import { TimeTrackingError } from "../time-tracking/errors.js";
import type { ReportingActor, ReportingRepository } from "./types.js";

export class ReportingService {
  public constructor(private readonly repository: ReportingRepository) {}

  public monthlyAttendance(actor: ReportingActor, month: string): Promise<MonthlyAttendanceReport> {
    if (!["owner", "admin", "manager", "auditor"].includes(actor.role)) {
      throw new TimeTrackingError("FORBIDDEN", "Keine Berechtigung für Berichte.");
    }
    return this.repository.monthlyAttendance(actor, month);
  }
}
