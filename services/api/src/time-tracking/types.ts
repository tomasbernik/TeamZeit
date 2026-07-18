import type { ClockCommandResponse, DailyAttendanceOverview, ISODate, ISOInstant, IanaTimeZone, MonthlyAttendanceOverview, UUID, WorkBreakDto, WorkSessionDto, WorkSessionSource } from "@teamzeit/contracts";
export type ClockEventType = "clock_in" | "break_start" | "break_end" | "clock_out";
export interface AttendanceMembershipContext { organizationId: UUID; membershipId: UUID; userId: UUID; organizationTimeZone: IanaTimeZone; }
export interface WorkBreakRecord extends WorkBreakDto { organizationId: UUID; workSessionId: UUID; }
export interface WorkSessionRecord extends Omit<WorkSessionDto, "breaks" | "state" | "workedMinutes"> { breaks: WorkBreakRecord[]; archivedAt?: ISOInstant; }
export interface ClockEventRecord { id: UUID; organizationId: UUID; workSessionId: UUID; membershipId: UUID; eventType: ClockEventType; occurredAt: ISOInstant; recordedAt: ISOInstant; requestId: UUID; }
export interface AuditEventRecord { id: UUID; organizationId: UUID; actorUserId: UUID; actorMembershipId: UUID; action: string; entityType: string; entityId: UUID; occurredAt: ISOInstant; requestId: UUID; beforeValues?: unknown; afterValues?: unknown; metadata?: Record<string, unknown>; }
export type StoredCommandResult = { kind: "clock"; response: ClockCommandResponse } | { kind: "session"; response: WorkSessionDto };
export interface TimeTrackingRepository {
  transaction?<T>(operation: () => Promise<T>): Promise<T>;
  findIdempotentResult(organizationId: UUID, membershipId: UUID, requestId: UUID): Promise<StoredCommandResult | undefined>;
  saveIdempotentResult(organizationId: UUID, membershipId: UUID, requestId: UUID, result: StoredCommandResult): Promise<void>;
  findOpenSession(organizationId: UUID, membershipId: UUID): Promise<WorkSessionRecord | undefined>;
  findSession(organizationId: UUID, membershipId: UUID, sessionId: UUID): Promise<WorkSessionRecord | undefined>;
  listSessions(organizationId: UUID, membershipId: UUID, from: ISODate, to: ISODate): Promise<WorkSessionRecord[]>;
  insertSession(session: WorkSessionRecord): Promise<void>; updateSession(session: WorkSessionRecord): Promise<void>;
  appendClockEvent(event: ClockEventRecord): Promise<void>; appendAuditEvent(event: AuditEventRecord): Promise<void>;
}
export interface PeriodGuard { assertPeriodOpen(input: { organizationId: UUID; membershipId: UUID; workDate: ISODate; operation: "clock" | "manual" | "correction"; }): Promise<void>; }
export interface Clock { now(): Date; } export interface IdGenerator { uuid(): UUID; }
export type { DailyAttendanceOverview, MonthlyAttendanceOverview };
export type NewWorkSessionInput = Omit<WorkSessionRecord, "breaks" | "source" | "version"> & { source?: WorkSessionSource; breaks?: WorkBreakRecord[]; version?: number; };
