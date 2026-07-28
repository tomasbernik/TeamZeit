import type { AttendanceState, IanaTimeZone, ISODate, WorkSessionDto } from "@teamzeit/contracts";
import { minutesBetween } from "./time.js";
import { localDateForInstant, localMidnightInstant, nextDate } from "./time.js";
import type { WorkSessionRecord } from "./types.js";

export function calculateWorkedMinutes(session: Pick<WorkSessionDto, "startedAt" | "endedAt">, until?: string): number | undefined {
  const end = session.endedAt ?? until;
  return end ? Math.max(0, minutesBetween(session.startedAt, end)) : undefined;
}

export function calculateGapMinutes(sessions: Pick<WorkSessionDto, "startedAt" | "endedAt">[]): number {
  const sorted = [...sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return sorted.slice(1).reduce((total, current, index) => {
    const previousEnd = sorted[index]?.endedAt;
    return previousEnd ? total + Math.max(0, minutesBetween(previousEnd, current.startedAt)) : total;
  }, 0);
}

export function deriveAttendanceState(session: WorkSessionRecord | undefined): AttendanceState {
  return session ? "working" : "not_started";
}

export function sessionCalculationEnd(session: WorkSessionRecord, now: string, timeZone: IanaTimeZone): { end?: string; missingClockOut: boolean } {
  if (session.endedAt) return { end: session.endedAt, missingClockOut: false };
  if (localDateForInstant(now, timeZone) <= session.workDate) return { end: now, missingClockOut: false };
  return { end: localMidnightInstant(nextDate(session.workDate), timeZone), missingClockOut: true };
}

export function toWorkSessionDto(session: WorkSessionRecord, until?: string, timeZone?: IanaTimeZone): WorkSessionDto {
  const calculation = until && timeZone ? sessionCalculationEnd(session, until, timeZone) : { end: session.endedAt ?? until, missingClockOut: false };
  const workedMinutes = calculateWorkedMinutes(session, calculation.end);
  return {
    id: session.id, organizationId: session.organizationId, membershipId: session.membershipId,
    workDate: session.workDate, startedAt: session.startedAt,
    ...(session.endedAt ? { endedAt: session.endedAt } : {}),
    ...(!session.endedAt && calculation.end ? { calculationEndedAt: calculation.end } : {}),
    ...(calculation.missingClockOut ? { issue: "missing_clock_out" as const } : {}),
    breaks: [], ...(workedMinutes === undefined ? {} : { workedMinutes }),
    state: calculation.missingClockOut ? "requires_action" : session.endedAt ? "completed" : "working", source: session.source, version: session.version,
  };
}

export function weekdayPlannedMinutes(date: ISODate, minutes: { monday: number; tuesday: number; wednesday: number; thursday: number; friday: number; saturday: number; sunday: number }): number {
  const keys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
  return minutes[keys[new Date(`${date}T12:00:00.000Z`).getUTCDay()]!];
}

export function applyBreakRule(recordedWorkMinutes: number, recordedBreakMinutes: number, threshold: number, minimum: number) {
  const automaticBreakMinutes = recordedWorkMinutes > threshold ? Math.max(0, minimum - recordedBreakMinutes) : 0;
  return { automaticBreakMinutes, creditedMinutes: Math.max(0, recordedWorkMinutes - automaticBreakMinutes) };
}
