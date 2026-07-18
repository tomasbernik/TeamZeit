import type { AttendanceState, WorkSessionDto } from "@teamzeit/contracts";
import { minutesBetween } from "./time.js";
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

export function toWorkSessionDto(session: WorkSessionRecord, until?: string): WorkSessionDto {
  const workedMinutes = calculateWorkedMinutes(session, until);
  return {
    id: session.id, organizationId: session.organizationId, membershipId: session.membershipId,
    workDate: session.workDate, startedAt: session.startedAt,
    ...(session.endedAt ? { endedAt: session.endedAt } : {}),
    breaks: [], ...(workedMinutes === undefined ? {} : { workedMinutes }),
    state: session.endedAt ? "not_started" : "working", source: session.source, version: session.version,
  };
}
