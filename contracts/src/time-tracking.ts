import type { ISODate, ISOInstant, UUID } from "./common";

export type AttendanceState = "not_started" | "working" | "completed";
export type WorkSessionSource = "clock" | "manual" | "admin_import";

export interface WorkBreakDto {
  id: UUID;
  startedAt: ISOInstant;
  endedAt?: ISOInstant;
  durationMinutes?: number;
}

export interface WorkSessionDto {
  id: UUID;
  organizationId: UUID;
  membershipId: UUID;
  workDate: ISODate;
  startedAt: ISOInstant;
  endedAt?: ISOInstant;
  breaks: WorkBreakDto[];
  workedMinutes?: number;
  state: AttendanceState;
  source: WorkSessionSource;
  version: number;
}

export interface TodayAttendanceResponse {
  serverTime: ISOInstant;
  workDate: ISODate;
  state: AttendanceState;
  activeSession?: WorkSessionDto;
  sessions: WorkSessionDto[];
  workedMinutes: number;
  breakMinutes: number;
}

export interface WorkSessionsResponse {
  items: WorkSessionDto[];
}

export interface ClockCommandResponse {
  serverTime: ISOInstant;
  session: WorkSessionDto;
}

export interface DailyAttendanceOverview {
  workDate: ISODate;
  state: AttendanceState;
  sessions: WorkSessionDto[];
  workedMinutes: number;
  breakMinutes: number;
}

export interface MonthlyAttendanceOverview {
  month: string;
  days: DailyAttendanceOverview[];
  workedMinutes: number;
  breakMinutes: number;
}

export interface CreateWorkSessionRequest {
  workDate: ISODate;
  startedAt: ISOInstant;
  endedAt: ISOInstant;
}

export interface UpdateWorkSessionRequest extends CreateWorkSessionRequest {
  expectedVersion: number;
}
