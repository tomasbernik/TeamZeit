import type { MonthlyAttendanceReport } from "@teamzeit/contracts";
import { errorMessageFromResponse } from "../auth/api";
import { webConfig } from "../config/env";

interface ReportingContext { accessToken: string; organizationId: string; fetcher?: typeof fetch; }

export async function fetchMonthlyReport(context: ReportingContext, month: string): Promise<MonthlyAttendanceReport> {
  const response = await (context.fetcher ?? fetch)(
    `${webConfig.apiUrl.replace(/\/$/, "")}/reports/attendance/${month}`,
    { headers: { Authorization: `Bearer ${context.accessToken}`, "X-Organization-Id": context.organizationId } },
  );
  if (!response.ok) throw new Error(await errorMessageFromResponse(response, "Der Monatsbericht konnte nicht geladen werden."));
  return response.json() as Promise<MonthlyAttendanceReport>;
}

export function reportCsv(report: MonthlyAttendanceReport): string {
  const quote = (value: string | number) => `"${String(value).replaceAll("\"", "\"\"")}"`;
  const rows = [
    ["E-Mail", "Arbeitszeit (Minuten)", "Intervalle", "Arbeitstage", "Offene Intervalle"],
    ...report.rows.map((row) => [row.email, row.workedMinutes, row.sessionCount, row.daysWorked, row.openSessionCount]),
  ];
  return `\uFEFF${rows.map((row) => row.map(quote).join(";")).join("\r\n")}\r\n`;
}
