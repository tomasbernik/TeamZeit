import type { UUID } from "./common";

export interface MonthlyAttendanceReportRow {
  membershipId: UUID;
  email: string;
  workedMinutes: number;
  sessionCount: number;
  daysWorked: number;
  openSessionCount: number;
}

export interface MonthlyAttendanceReport {
  organizationId: UUID;
  month: string;
  rows: MonthlyAttendanceReportRow[];
  totals: Omit<MonthlyAttendanceReportRow, "membershipId" | "email">;
}
