import type { AttendanceState, ClockCommandResponse, CorrectionRequestDto, ISODate, TodayAttendanceResponse, UUID } from "@teamzeit/contracts";

import {
  calculateBreakMinutes,
  correctionValuesFromSession,
  deriveAttendanceState,
  toWorkSessionDto,
  validateCorrectionValues,
} from "./calculations.js";
import { conflict, invalidState, validationError } from "./errors.js";
import { localDateForInstant, monthBounds, toIsoInstant } from "./time.js";
import type {
  AttendanceMembershipContext,
  Clock,
  ClockEventType,
  CreateCorrectionCommand,
  DailyAttendanceOverview,
  IdGenerator,
  MonthlyAttendanceOverview,
  PeriodGuard,
  ReviewerContext,
  ReviewCorrectionCommand,
  StoredCommandResult,
  TimeTrackingRepository,
  WorkBreakRecord,
  WorkSessionRecord,
} from "./types.js";

export interface TimeTrackingServiceDependencies {
  repository: TimeTrackingRepository;
  periodGuard: PeriodGuard;
  clock: Clock;
  ids: IdGenerator;
}

export class TimeTrackingService {
  private readonly repository: TimeTrackingRepository;
  private readonly periodGuard: PeriodGuard;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  public constructor(dependencies: TimeTrackingServiceDependencies) {
    this.repository = dependencies.repository;
    this.periodGuard = dependencies.periodGuard;
    this.clock = dependencies.clock;
    this.ids = dependencies.ids;
  }

  public async clockIn(context: AttendanceMembershipContext, requestId: UUID): Promise<ClockCommandResponse> {
    return this.runClockCommand(context, requestId, "clock_in", async (occurredAt) => {
      const workDate = localDateForInstant(occurredAt, context.organizationTimeZone);
      await this.periodGuard.assertPeriodOpen({
        organizationId: context.organizationId,
        membershipId: context.membershipId,
        workDate,
        operation: "clock",
      });

      const existing = await this.repository.findOpenSession(context.organizationId, context.membershipId);
      if (existing) {
        throw invalidState("Cannot clock in while a work session is already open.");
      }

      const session: WorkSessionRecord = {
        id: this.ids.uuid(),
        organizationId: context.organizationId,
        membershipId: context.membershipId,
        workDate,
        startedAt: occurredAt,
        breaks: [],
        source: "clock",
        version: 1,
      };

      await this.repository.insertSession(session);
      return session;
    });
  }

  public async startBreak(context: AttendanceMembershipContext, requestId: UUID): Promise<ClockCommandResponse> {
    return this.runClockCommand(context, requestId, "break_start", async (occurredAt) => {
      const session = await this.requireOpenSession(context);
      await this.assertSessionPeriodOpen(context, session);

      if (deriveAttendanceState(session) === "on_break") {
        throw invalidState("Cannot start a break while another break is open.");
      }

      const workBreak: WorkBreakRecord = {
        id: this.ids.uuid(),
        organizationId: context.organizationId,
        workSessionId: session.id,
        startedAt: occurredAt,
      };
      const updated = { ...session, breaks: [...session.breaks, workBreak], version: session.version + 1 };

      await this.repository.updateSession(updated);
      return updated;
    });
  }

  public async endBreak(context: AttendanceMembershipContext, requestId: UUID): Promise<ClockCommandResponse> {
    return this.runClockCommand(context, requestId, "break_end", async (occurredAt) => {
      const session = await this.requireOpenSession(context);
      await this.assertSessionPeriodOpen(context, session);

      const openBreak = session.breaks.find((workBreak) => !workBreak.endedAt);
      if (!openBreak) {
        throw invalidState("Cannot end a break when no break is open.");
      }

      const breaks = session.breaks.map((workBreak) =>
        workBreak.id === openBreak.id ? { ...workBreak, endedAt: occurredAt } : workBreak,
      );
      const updated = { ...session, breaks, version: session.version + 1 };

      await this.repository.updateSession(updated);
      return updated;
    });
  }

  public async clockOut(context: AttendanceMembershipContext, requestId: UUID): Promise<ClockCommandResponse> {
    return this.runClockCommand(context, requestId, "clock_out", async (occurredAt) => {
      const session = await this.requireOpenSession(context);
      await this.assertSessionPeriodOpen(context, session);

      if (deriveAttendanceState(session) === "on_break") {
        throw invalidState("Cannot clock out while a break is open.");
      }

      const updated = { ...session, endedAt: occurredAt, version: session.version + 1 };
      await this.repository.updateSession(updated);
      return updated;
    });
  }

  public async getCurrentDay(context: AttendanceMembershipContext): Promise<TodayAttendanceResponse> {
    const serverTime = toIsoInstant(this.clock.now());
    const session = await this.repository.findOpenSession(context.organizationId, context.membershipId);

    return {
      serverTime,
      state: deriveAttendanceState(session),
      ...(session ? { activeSession: toWorkSessionDto(session, serverTime) } : {}),
    };
  }

  public async getDailyOverview(context: AttendanceMembershipContext, workDate: ISODate): Promise<DailyAttendanceOverview> {
    const sessions = await this.repository.listSessions(context.organizationId, context.membershipId, workDate, workDate);
    return this.buildDailyOverview(workDate, sessions);
  }

  public async getMonthlyOverview(context: AttendanceMembershipContext, month: string): Promise<MonthlyAttendanceOverview> {
    const { from, to } = monthBounds(month);
    const sessions = await this.repository.listSessions(context.organizationId, context.membershipId, from, to);
    const byDate = new Map<ISODate, WorkSessionRecord[]>();

    for (const session of sessions) {
      const existing = byDate.get(session.workDate) ?? [];
      existing.push(session);
      byDate.set(session.workDate, existing);
    }

    const days = [...byDate.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([workDate, daySessions]) => this.buildDailyOverview(workDate, daySessions));

    return {
      month,
      days,
      workedMinutes: days.reduce((total, day) => total + day.workedMinutes, 0),
      breakMinutes: days.reduce((total, day) => total + day.breakMinutes, 0),
    };
  }

  public async createCorrection(
    context: AttendanceMembershipContext,
    requestId: UUID,
    command: CreateCorrectionCommand,
  ): Promise<CorrectionRequestDto> {
    const existingResult = await this.repository.findIdempotentResult(context.organizationId, requestId);
    if (existingResult) {
      return this.expectCorrectionResult(existingResult);
    }

    validateCorrectionValues(command.proposed);
    await this.periodGuard.assertPeriodOpen({
      organizationId: context.organizationId,
      membershipId: context.membershipId,
      workDate: command.proposed.workDate,
      operation: "correction",
    });

    const session = await this.repository.findSession(context.organizationId, context.membershipId, command.sessionId);
    if (!session) {
      throw validationError("Session was not found for the current membership.", "sessionId");
    }

    if (session.version !== command.expectedVersion) {
      throw conflict("Session version is stale.", "expectedVersion");
    }

    const original = correctionValuesFromSession(session);
    const now = toIsoInstant(this.clock.now());
    const correction: CorrectionRequestDto & { expectedVersion: number } = {
      id: this.ids.uuid(),
      organizationId: context.organizationId,
      requesterMembershipId: context.membershipId,
      sessionId: session.id,
      original,
      proposed: command.proposed,
      reason: command.reason,
      status: "pending",
      createdAt: now,
      expectedVersion: command.expectedVersion,
    };

    await this.repository.insertCorrection(correction);
    await this.repository.saveIdempotentResult(context.organizationId, requestId, { kind: "correction", response: correction });
    return correction;
  }

  public async reviewCorrection(
    context: ReviewerContext,
    correctionId: UUID,
    requestId: UUID,
    command: ReviewCorrectionCommand,
  ): Promise<CorrectionRequestDto> {
    const existingResult = await this.repository.findIdempotentResult(context.organizationId, requestId);
    if (existingResult) {
      return this.expectCorrectionResult(existingResult);
    }

    if (!context.canReviewCorrections) {
      throw conflict("Reviewer is not authorised for correction review.");
    }

    const correction = await this.repository.findCorrection(context.organizationId, correctionId);
    if (!correction) {
      throw validationError("Correction was not found.", "correctionId");
    }

    if (correction.requesterMembershipId === context.membershipId) {
      throw conflict("A requester cannot review their own correction.");
    }

    if (correction.status !== "pending") {
      throw conflict("Correction has already been reviewed.");
    }

    await this.periodGuard.assertPeriodOpen({
      organizationId: context.organizationId,
      membershipId: correction.requesterMembershipId,
      workDate: correction.proposed.workDate,
      operation: "correction",
    });

    const now = toIsoInstant(this.clock.now());
    const reviewed: CorrectionRequestDto & { expectedVersion: number } = {
      ...correction,
      status: command.decision === "approve" ? "approved" : "rejected",
      reviewedByMembershipId: context.membershipId,
      ...(command.comment ? { reviewComment: command.comment } : {}),
      reviewedAt: now,
    };

    if (command.decision === "approve") {
      const session = await this.repository.findSession(
        context.organizationId,
        correction.requesterMembershipId,
        correction.sessionId,
      );

      if (!session) {
        throw conflict("Session for correction no longer exists.");
      }

      if (session.version !== correction.expectedVersion) {
        throw conflict("Session version is stale.");
      }

      await this.repository.updateSession({
        ...session,
        workDate: correction.proposed.workDate,
        startedAt: correction.proposed.startedAt,
        endedAt: correction.proposed.endedAt,
        breaks: buildSyntheticCorrectionBreaks(session, correction.proposed.startedAt, correction.proposed.breakMinutes, this.ids.uuid()),
        source: "approved_correction",
        version: session.version + 1,
      });
    }

    await this.repository.updateCorrection(reviewed);
    await this.repository.appendAuditEvent({
      id: this.ids.uuid(),
      organizationId: context.organizationId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: command.decision === "approve" ? "correction.approved" : "correction.rejected",
      entityType: "correction_request",
      entityId: correction.id,
      occurredAt: now,
      requestId,
      beforeValues: correction.original,
      afterValues: command.decision === "approve" ? correction.proposed : undefined,
      metadata: { sessionId: correction.sessionId },
    });
    await this.repository.saveIdempotentResult(context.organizationId, requestId, { kind: "correction", response: reviewed });
    return reviewed;
  }

  private async runClockCommand(
    context: AttendanceMembershipContext,
    requestId: UUID,
    eventType: ClockEventType,
    mutate: (occurredAt: string) => Promise<WorkSessionRecord>,
  ): Promise<ClockCommandResponse> {
    const existingResult = await this.repository.findIdempotentResult(context.organizationId, requestId);
    if (existingResult) {
      return this.expectClockResult(existingResult);
    }

    const serverTime = toIsoInstant(this.clock.now());
    const session = await mutate(serverTime);

    await this.repository.appendClockEvent({
      id: this.ids.uuid(),
      organizationId: context.organizationId,
      workSessionId: session.id,
      membershipId: context.membershipId,
      eventType,
      occurredAt: serverTime,
      recordedAt: serverTime,
      requestId,
    });

    const response = { serverTime, session: toWorkSessionDto(session, serverTime) };
    await this.repository.saveIdempotentResult(context.organizationId, requestId, { kind: "clock", response });
    return response;
  }

  private async requireOpenSession(context: AttendanceMembershipContext): Promise<WorkSessionRecord> {
    const session = await this.repository.findOpenSession(context.organizationId, context.membershipId);
    if (!session) {
      throw invalidState("Cannot perform this operation before clocking in.");
    }

    return session;
  }

  private async assertSessionPeriodOpen(context: AttendanceMembershipContext, session: WorkSessionRecord): Promise<void> {
    await this.periodGuard.assertPeriodOpen({
      organizationId: context.organizationId,
      membershipId: context.membershipId,
      workDate: session.workDate,
      operation: "clock",
    });
  }

  private buildDailyOverview(workDate: ISODate, sessions: WorkSessionRecord[]): DailyAttendanceOverview {
    const now = toIsoInstant(this.clock.now());
    const sessionDtos = sessions.map((session) => toWorkSessionDto(session, now));
    const workedMinutes = sessionDtos.reduce((total, session) => total + (session.workedMinutes ?? 0), 0);
    const openSession = sessions.find((session) => !session.endedAt);
    const state: AttendanceState = openSession ? deriveAttendanceState(openSession) : "not_started";

    return {
      workDate,
      state,
      sessions: sessionDtos,
      workedMinutes,
      breakMinutes: sessionDtos.reduce((total, session) => total + calculateBreakMinutes(session.breaks, now), 0),
    };
  }

  private expectClockResult(result: StoredCommandResult): ClockCommandResponse {
    if (result.kind !== "clock") {
      throw conflict("Idempotency key was already used for a different command.");
    }

    return result.response;
  }

  private expectCorrectionResult(result: StoredCommandResult): CorrectionRequestDto {
    if (result.kind !== "correction") {
      throw conflict("Idempotency key was already used for a different command.");
    }

    return result.response;
  }
}

function buildSyntheticCorrectionBreaks(
  session: WorkSessionRecord,
  correctedStartedAt: string,
  breakMinutes: number,
  breakId: UUID,
): WorkBreakRecord[] {
  if (breakMinutes === 0) {
    return [];
  }

  const startedAt = correctedStartedAt;
  const endedAt = new Date(Date.parse(startedAt) + breakMinutes * 60_000).toISOString();

  return [
    {
      id: breakId,
      organizationId: session.organizationId,
      workSessionId: session.id,
      startedAt,
      endedAt,
      durationMinutes: breakMinutes,
    },
  ];
}
