import type { ISODate, ISOInstant, UUID } from "./common";

export type AttendanceState = "not_started" | "working" | "on_break" | "completed";
export type WorkSessionSource = "clock" | "approved_correction" | "admin_import";
export type CorrectionStatus = "pending" | "approved" | "rejected" | "cancelled";

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
  state: AttendanceState;
  activeSession?: WorkSessionDto;
}

export interface ClockCommandResponse {
  serverTime: ISOInstant;
  session: WorkSessionDto;
}

export interface CorrectionValues {
  workDate: ISODate;
  startedAt: ISOInstant;
  endedAt: ISOInstant;
  breakMinutes: number;
}

export interface CreateCorrectionRequest {
  sessionId: UUID;
  expectedVersion: number;
  proposed: CorrectionValues;
  reason: string;
}

export interface CorrectionRequestDto {
  id: UUID;
  organizationId: UUID;
  requesterMembershipId: UUID;
  sessionId: UUID;
  original: CorrectionValues;
  proposed: CorrectionValues;
  reason: string;
  status: CorrectionStatus;
  reviewedByMembershipId?: UUID;
  reviewComment?: string;
  createdAt: ISOInstant;
  reviewedAt?: ISOInstant;
}

export interface ReviewCorrectionRequest {
  decision: "approve" | "reject";
  comment?: string;
}
