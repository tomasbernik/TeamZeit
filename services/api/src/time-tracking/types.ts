import type {
  ClockCommandResponse,
  CorrectionRequestDto,
  CorrectionValues,
  DailyAttendanceOverview,
  ISODate,
  ISOInstant,
  IanaTimeZone,
  MonthlyAttendanceOverview,
  ReviewCorrectionRequest,
  UUID,
  WorkBreakDto,
  WorkSessionDto,
  WorkSessionSource,
} from "@teamzeit/contracts";

export type ClockEventType = "clock_in" | "break_start" | "break_end" | "clock_out";

export interface AttendanceMembershipContext {
  organizationId: UUID;
  membershipId: UUID;
  userId: UUID;
  organizationTimeZone: IanaTimeZone;
}

export interface ReviewerContext extends AttendanceMembershipContext {
  canReviewCorrections: boolean;
}

export interface WorkBreakRecord extends WorkBreakDto {
  organizationId: UUID;
  workSessionId: UUID;
}

export interface WorkSessionRecord extends Omit<WorkSessionDto, "breaks" | "state" | "workedMinutes"> {
  breaks: WorkBreakRecord[];
}

export interface ClockEventRecord {
  id: UUID;
  organizationId: UUID;
  workSessionId: UUID;
  membershipId: UUID;
  eventType: ClockEventType;
  occurredAt: ISOInstant;
  recordedAt: ISOInstant;
  requestId: UUID;
}

export interface AuditEventRecord {
  id: UUID;
  organizationId: UUID;
  actorUserId: UUID;
  actorMembershipId: UUID;
  action: string;
  entityType: string;
  entityId: UUID;
  occurredAt: ISOInstant;
  requestId: UUID;
  beforeValues?: unknown;
  afterValues?: unknown;
  metadata?: Record<string, unknown>;
}

export interface CorrectionRecord extends CorrectionRequestDto {
  expectedVersion: number;
}

export type StoredCommandResult =
  | { kind: "clock"; response: ClockCommandResponse }
  | { kind: "correction"; response: CorrectionRequestDto };

export interface TimeTrackingRepository {
  findIdempotentResult(organizationId: UUID, requestId: UUID): Promise<StoredCommandResult | undefined>;
  saveIdempotentResult(organizationId: UUID, requestId: UUID, result: StoredCommandResult): Promise<void>;
  findOpenSession(organizationId: UUID, membershipId: UUID): Promise<WorkSessionRecord | undefined>;
  findSession(organizationId: UUID, membershipId: UUID, sessionId: UUID): Promise<WorkSessionRecord | undefined>;
  listSessions(organizationId: UUID, membershipId: UUID, from: ISODate, to: ISODate): Promise<WorkSessionRecord[]>;
  insertSession(session: WorkSessionRecord): Promise<void>;
  updateSession(session: WorkSessionRecord): Promise<void>;
  appendClockEvent(event: ClockEventRecord): Promise<void>;
  insertCorrection(correction: CorrectionRecord): Promise<void>;
  findCorrection(organizationId: UUID, correctionId: UUID): Promise<CorrectionRecord | undefined>;
  updateCorrection(correction: CorrectionRecord): Promise<void>;
  appendAuditEvent(event: AuditEventRecord): Promise<void>;
}

export interface PeriodGuard {
  assertPeriodOpen(input: {
    organizationId: UUID;
    membershipId: UUID;
    workDate: ISODate;
    operation: "clock" | "correction";
  }): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  uuid(): UUID;
}

export type { DailyAttendanceOverview, MonthlyAttendanceOverview };

export interface CreateCorrectionCommand {
  sessionId: UUID;
  expectedVersion: number;
  proposed: CorrectionValues;
  reason: string;
}

export type ReviewCorrectionCommand = ReviewCorrectionRequest;

export type NewWorkSessionInput = Omit<WorkSessionRecord, "breaks" | "source" | "version"> & {
  source?: WorkSessionSource;
  breaks?: WorkBreakRecord[];
  version?: number;
};
