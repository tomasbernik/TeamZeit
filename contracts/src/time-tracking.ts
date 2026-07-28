import type { ISODate, ISOInstant, UUID } from "./common";

export type AttendanceState = "not_started" | "working" | "completed" | "requires_action";
export type WorkSessionSource = "clock" | "manual" | "admin_import";
export type AttendanceIssue = "missing_clock_out";

export interface WeekdayMinutes {
  monday: number;
  tuesday: number;
  wednesday: number;
  thursday: number;
  friday: number;
  saturday: number;
  sunday: number;
}

export interface EmployeeWorkRuleDto {
  id: UUID;
  organizationId: UUID;
  membershipId: UUID;
  effectiveFrom: ISODate;
  effectiveTo?: ISODate;
  weekdayMinutes: WeekdayMinutes;
  breakThresholdMinutes: number;
  minimumBreakMinutes: number;
}

export interface SetEmployeeWorkRuleRequest {
  effectiveFrom: ISODate;
  weekdayMinutes: WeekdayMinutes;
  breakThresholdMinutes?: number | undefined;
  minimumBreakMinutes?: number | undefined;
}

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
  calculationEndedAt?: ISOInstant;
  issue?: AttendanceIssue;
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
  recordedBreakMinutes: number;
  automaticBreakMinutes: number;
  plannedMinutes: number;
  balanceMinutes: number;
  isHoliday: boolean;
  requiresAction: boolean;
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
  recordedBreakMinutes: number;
  automaticBreakMinutes: number;
  plannedMinutes: number;
  balanceMinutes: number;
  isHoliday: boolean;
  requiresAction: boolean;
}

export interface MonthlyAttendanceOverview {
  month: string;
  days: DailyAttendanceOverview[];
  workedMinutes: number;
  breakMinutes: number;
  plannedMinutes: number;
  balanceMinutes: number;
  requiresAction: boolean;
}

export interface CreateWorkSessionRequest {
  workDate: ISODate;
  startedAt: ISOInstant;
  endedAt: ISOInstant;
}

export interface UpdateWorkSessionRequest extends CreateWorkSessionRequest {
  expectedVersion: number;
}
