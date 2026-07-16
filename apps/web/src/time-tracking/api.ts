import type {
  ClockCommandResponse,
  CreateCorrectionRequest,
  DailyAttendanceOverview,
  MonthlyAttendanceOverview,
  TodayAttendanceResponse,
} from "@teamzeit/contracts";

import { errorMessageFromResponse } from "../auth/api";
import { webConfig } from "../config/env";

export type ClockCommand = "clock-in" | "break-start" | "break-end" | "clock-out";

interface AttendanceRequestContext {
  accessToken: string;
  organizationId: string;
  fetcher?: typeof fetch;
}

const commandLabels: Record<ClockCommand, string> = {
  "clock-in": "Der Arbeitsbeginn konnte nicht erfasst werden.",
  "break-start": "Die Pause konnte nicht gestartet werden.",
  "break-end": "Die Pause konnte nicht beendet werden.",
  "clock-out": "Das Arbeitsende konnte nicht erfasst werden.",
};

function apiUrl(path: string): string {
  return `${webConfig.apiUrl.replace(/\/$/, "")}${path}`;
}

function readHeaders(context: AttendanceRequestContext): HeadersInit {
  return {
    Authorization: `Bearer ${context.accessToken}`,
    "X-Organization-Id": context.organizationId,
  };
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    throw new Error(await errorMessageFromResponse(response, fallback));
  }

  return (await response.json()) as T;
}

export async function fetchTodayAttendance(context: AttendanceRequestContext): Promise<TodayAttendanceResponse> {
  const response = await (context.fetcher ?? fetch)(apiUrl("/attendance/today"), {
    headers: readHeaders(context),
  });
  return readJson<TodayAttendanceResponse>(response, "Der heutige Arbeitsstand konnte nicht geladen werden.");
}

export async function fetchDailyAttendance(context: AttendanceRequestContext, workDate: string): Promise<DailyAttendanceOverview> {
  const response = await (context.fetcher ?? fetch)(apiUrl(`/attendance/days/${workDate}`), {
    headers: readHeaders(context),
  });
  return readJson<DailyAttendanceOverview>(response, "Der Tagesüberblick konnte nicht geladen werden.");
}

export async function fetchMonthlyAttendance(context: AttendanceRequestContext, month: string): Promise<MonthlyAttendanceOverview> {
  const response = await (context.fetcher ?? fetch)(apiUrl(`/attendance/months/${month}`), {
    headers: readHeaders(context),
  });
  return readJson<MonthlyAttendanceOverview>(response, "Der Monatsüberblick konnte nicht geladen werden.");
}

export async function sendClockCommand(
  context: AttendanceRequestContext,
  command: ClockCommand,
  idempotencyKey: string,
): Promise<ClockCommandResponse> {
  const response = await (context.fetcher ?? fetch)(apiUrl(`/attendance/commands/${command}`), {
    method: "POST",
    headers: {
      ...readHeaders(context),
      "Idempotency-Key": idempotencyKey,
    },
  });
  return readJson<ClockCommandResponse>(response, commandLabels[command]);
}

export async function createCorrectionRequest(
  context: AttendanceRequestContext,
  request: CreateCorrectionRequest,
  idempotencyKey: string,
): Promise<void> {
  const response = await (context.fetcher ?? fetch)(apiUrl("/corrections"), {
    method: "POST",
    headers: {
      ...readHeaders(context),
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(request),
  });

  await readJson(response, "Die Korrekturanfrage konnte nicht gesendet werden.");
}
