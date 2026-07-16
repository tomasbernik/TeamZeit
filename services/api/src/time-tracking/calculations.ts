import type { AttendanceState, CorrectionValues, WorkBreakDto, WorkSessionDto } from "@teamzeit/contracts";

import { validationError } from "./errors.js";
import { minutesBetween } from "./time.js";
import type { WorkSessionRecord } from "./types.js";

export function calculateBreakMinutes(breaks: WorkBreakDto[], until?: string): number {
  return breaks.reduce((total, workBreak) => {
    const endedAt = workBreak.endedAt ?? until;
    if (!endedAt) {
      return total;
    }

    return total + minutesBetween(workBreak.startedAt, endedAt);
  }, 0);
}

export function calculateWorkedMinutes(session: Pick<WorkSessionDto, "startedAt" | "endedAt" | "breaks">, until?: string): number | undefined {
  const endedAt = session.endedAt ?? until;
  if (!endedAt) {
    return undefined;
  }

  return Math.max(0, minutesBetween(session.startedAt, endedAt) - calculateBreakMinutes(session.breaks, endedAt));
}

export function deriveAttendanceState(session: WorkSessionRecord | undefined): AttendanceState {
  if (!session) {
    return "not_started";
  }

  if (session.endedAt) {
    return "completed";
  }

  if (session.breaks.some((workBreak) => !workBreak.endedAt)) {
    return "on_break";
  }

  return "working";
}

export function toWorkSessionDto(session: WorkSessionRecord, until?: string): WorkSessionDto {
  const state = deriveAttendanceState(session);
  const breaks = session.breaks.map((workBreak) => ({
    id: workBreak.id,
    startedAt: workBreak.startedAt,
    ...(workBreak.endedAt ? { endedAt: workBreak.endedAt } : {}),
    ...((workBreak.endedAt || until) ? { durationMinutes: minutesBetween(workBreak.startedAt, workBreak.endedAt ?? until!) } : {}),
  }));
  const workedMinutes = calculateWorkedMinutes({ ...session, breaks }, until);

  return {
    id: session.id,
    organizationId: session.organizationId,
    membershipId: session.membershipId,
    workDate: session.workDate,
    startedAt: session.startedAt,
    ...(session.endedAt ? { endedAt: session.endedAt } : {}),
    breaks,
    ...(workedMinutes === undefined ? {} : { workedMinutes }),
    state,
    source: session.source,
    version: session.version,
  };
}

export function correctionValuesFromSession(session: WorkSessionRecord): CorrectionValues {
  if (!session.endedAt) {
    throw validationError("Only completed sessions can be corrected.", "sessionId");
  }

  return {
    workDate: session.workDate,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    breakMinutes: calculateBreakMinutes(session.breaks),
  };
}

export function validateCorrectionValues(values: CorrectionValues): void {
  if (Date.parse(values.endedAt) < Date.parse(values.startedAt)) {
    throw validationError("Correction end time must be after the start time.", "proposed.endedAt");
  }

  const totalMinutes = minutesBetween(values.startedAt, values.endedAt);
  if (values.breakMinutes > totalMinutes) {
    throw validationError("Correction break minutes cannot exceed the session duration.", "proposed.breakMinutes");
  }
}
