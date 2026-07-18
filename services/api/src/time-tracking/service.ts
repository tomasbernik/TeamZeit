import type { ClockCommandResponse, CreateWorkSessionRequest, ISODate, TodayAttendanceResponse, UUID, UpdateWorkSessionRequest, WorkSessionDto, WorkSessionsResponse } from "@teamzeit/contracts";
import { calculateGapMinutes, deriveAttendanceState, toWorkSessionDto } from "./calculations.js";
import { conflict, invalidState, validationError } from "./errors.js";
import { localDateForInstant, monthBounds, toIsoInstant } from "./time.js";
import type { AttendanceMembershipContext, Clock, ClockEventType, DailyAttendanceOverview, IdGenerator, MonthlyAttendanceOverview, PeriodGuard, TimeTrackingRepository, WorkSessionRecord } from "./types.js";

export interface TimeTrackingServiceDependencies { repository: TimeTrackingRepository; periodGuard: PeriodGuard; clock: Clock; ids: IdGenerator; }

export class TimeTrackingService {
  public constructor(private readonly dependencies: TimeTrackingServiceDependencies) {}

  public clockIn(context: AttendanceMembershipContext, requestId: UUID): Promise<ClockCommandResponse> {
    return this.runClockCommand(context, requestId, "clock_in", async (now) => {
      const workDate = localDateForInstant(now, context.organizationTimeZone);
      await this.assertOpen(context, workDate, "clock");
      if (await this.dependencies.repository.findOpenSession(context.organizationId, context.membershipId)) throw invalidState("Sie sind bereits eingestempelt.");
      const session: WorkSessionRecord = { id: this.dependencies.ids.uuid(), organizationId: context.organizationId, membershipId: context.membershipId, workDate, startedAt: now, breaks: [], source: "clock", version: 1 };
      await this.ensureNoOverlap(context, session);
      await this.dependencies.repository.insertSession(session);
      return session;
    });
  }

  public clockOut(context: AttendanceMembershipContext, requestId: UUID): Promise<ClockCommandResponse> {
    return this.runClockCommand(context, requestId, "clock_out", async (now) => {
      const session = await this.dependencies.repository.findOpenSession(context.organizationId, context.membershipId);
      if (!session) throw invalidState("Sie sind nicht eingestempelt.");
      await this.assertOpen(context, session.workDate, "clock");
      if (Date.parse(now) <= Date.parse(session.startedAt)) throw invalidState("Das Ende muss nach dem Beginn liegen.");
      const updated = { ...session, endedAt: now, version: session.version + 1 };
      await this.dependencies.repository.updateSession(updated);
      return updated;
    });
  }

  /** Deprecated compatibility alias: a break starts by closing the current interval. */
  public startBreak(context: AttendanceMembershipContext, requestId: UUID) { return this.runClockAlias(context, requestId, "break_start", false); }
  /** Deprecated compatibility alias: a break ends by opening a new interval. */
  public endBreak(context: AttendanceMembershipContext, requestId: UUID) { return this.runClockAlias(context, requestId, "break_end", true); }

  public async getCurrentDay(context: AttendanceMembershipContext): Promise<TodayAttendanceResponse> {
    const serverTime = toIsoInstant(this.dependencies.clock.now());
    const workDate = localDateForInstant(serverTime, context.organizationTimeZone);
    const sessions = await this.dependencies.repository.listSessions(context.organizationId, context.membershipId, workDate, workDate);
    const active = sessions.find((item) => !item.endedAt);
    const overview = this.buildDailyOverview(workDate, sessions, serverTime);
    return { serverTime, workDate, state: deriveAttendanceState(active), ...(active ? { activeSession: toWorkSessionDto(active, serverTime) } : {}), sessions: overview.sessions, workedMinutes: overview.workedMinutes, breakMinutes: overview.breakMinutes };
  }

  public async getDailyOverview(context: AttendanceMembershipContext, workDate: ISODate): Promise<DailyAttendanceOverview> {
    return this.buildDailyOverview(workDate, await this.dependencies.repository.listSessions(context.organizationId, context.membershipId, workDate, workDate));
  }

  public async getMonthlyOverview(context: AttendanceMembershipContext, month: string): Promise<MonthlyAttendanceOverview> {
    const { from, to } = monthBounds(month);
    const sessions = await this.dependencies.repository.listSessions(context.organizationId, context.membershipId, from, to);
    const grouped = new Map<string, WorkSessionRecord[]>();
    for (const session of sessions) grouped.set(session.workDate, [...(grouped.get(session.workDate) ?? []), session]);
    const days = [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([date, items]) => this.buildDailyOverview(date, items));
    return { month, days, workedMinutes: days.reduce((n, day) => n + day.workedMinutes, 0), breakMinutes: days.reduce((n, day) => n + day.breakMinutes, 0) };
  }

  public async listOwnSessions(context: AttendanceMembershipContext, from: ISODate, to: ISODate): Promise<WorkSessionsResponse> {
    return { items: (await this.dependencies.repository.listSessions(context.organizationId, context.membershipId, from, to)).map((item) => toWorkSessionDto(item)) };
  }

  public createSession(context: AttendanceMembershipContext, requestId: UUID, input: CreateWorkSessionRequest): Promise<WorkSessionDto> {
    return this.runSessionCommand(context, requestId, async () => {
      this.validateInterval(context, input);
      await this.assertOpen(context, input.workDate, "manual");
      const session: WorkSessionRecord = { id: this.dependencies.ids.uuid(), organizationId: context.organizationId, membershipId: context.membershipId, ...input, breaks: [], source: "manual", version: 1 };
      await this.ensureNoOverlap(context, session);
      await this.dependencies.repository.insertSession(session);
      await this.audit(context, requestId, "work_session.created", session, undefined, session);
      return session;
    });
  }

  public updateSession(context: AttendanceMembershipContext, sessionId: UUID, requestId: UUID, input: UpdateWorkSessionRequest): Promise<WorkSessionDto> {
    return this.runSessionCommand(context, requestId, async () => {
      this.validateInterval(context, input);
      const existing = await this.requireOwnSession(context, sessionId);
      if (existing.version !== input.expectedVersion) throw conflict("Der Eintrag wurde zwischenzeitlich geändert.", "expectedVersion");
      await this.assertOpen(context, existing.workDate, "manual");
      if (input.workDate !== existing.workDate) await this.assertOpen(context, input.workDate, "manual");
      const updated = { ...existing, workDate: input.workDate, startedAt: input.startedAt, endedAt: input.endedAt, source: "manual" as const, version: existing.version + 1 };
      await this.ensureNoOverlap(context, updated, existing.id);
      await this.dependencies.repository.updateSession(updated);
      await this.audit(context, requestId, "work_session.updated", updated, existing, updated);
      return updated;
    });
  }

  public archiveSession(context: AttendanceMembershipContext, sessionId: UUID, requestId: UUID, expectedVersion: number): Promise<WorkSessionDto> {
    return this.runSessionCommand(context, requestId, async () => {
      const existing = await this.requireOwnSession(context, sessionId);
      if (existing.version !== expectedVersion) throw conflict("Der Eintrag wurde zwischenzeitlich geändert.", "expectedVersion");
      await this.assertOpen(context, existing.workDate, "manual");
      const archived = { ...existing, archivedAt: toIsoInstant(this.dependencies.clock.now()), version: existing.version + 1 };
      await this.dependencies.repository.updateSession(archived);
      await this.audit(context, requestId, "work_session.archived", archived, existing, undefined);
      return archived;
    });
  }

  private async runClockAlias(context: AttendanceMembershipContext, requestId: UUID, eventType: ClockEventType, opens: boolean) {
    return this.runClockCommand(context, requestId, eventType, async (now) => {
      if (opens) {
        const workDate = localDateForInstant(now, context.organizationTimeZone);
        await this.assertOpen(context, workDate, "clock");
        if (await this.dependencies.repository.findOpenSession(context.organizationId, context.membershipId)) throw invalidState("Sie sind bereits eingestempelt.");
        const session: WorkSessionRecord = { id: this.dependencies.ids.uuid(), organizationId: context.organizationId, membershipId: context.membershipId, workDate, startedAt: now, breaks: [], source: "clock", version: 1 };
        await this.ensureNoOverlap(context, session);
        await this.dependencies.repository.insertSession(session); return session;
      }
      const session = await this.dependencies.repository.findOpenSession(context.organizationId, context.membershipId);
      if (!session) throw invalidState("Sie sind nicht eingestempelt.");
      await this.assertOpen(context, session.workDate, "clock");
      if (Date.parse(now) <= Date.parse(session.startedAt)) throw invalidState("Das Ende muss nach dem Beginn liegen.");
      const updated = { ...session, endedAt: now, version: session.version + 1 };
      await this.dependencies.repository.updateSession(updated); return updated;
    });
  }

  private runClockCommand(context: AttendanceMembershipContext, requestId: UUID, eventType: ClockEventType, mutation: (now: string) => Promise<WorkSessionRecord>): Promise<ClockCommandResponse> {
    return this.transaction(async () => {
      const previous = await this.dependencies.repository.findIdempotentResult(context.organizationId, context.membershipId, requestId);
      if (previous) { if (previous.kind !== "clock") throw conflict("Der Idempotency-Key wurde bereits verwendet."); return previous.response as ClockCommandResponse; }
      const serverTime = toIsoInstant(this.dependencies.clock.now()); const session = await mutation(serverTime);
      await this.dependencies.repository.appendClockEvent({ id: this.dependencies.ids.uuid(), organizationId: context.organizationId, workSessionId: session.id, membershipId: context.membershipId, eventType, occurredAt: serverTime, recordedAt: serverTime, requestId });
      const response = { serverTime, session: toWorkSessionDto(session, serverTime) };
      await this.dependencies.repository.saveIdempotentResult(context.organizationId, context.membershipId, requestId, { kind: "clock", response }); return response;
    });
  }

  private runSessionCommand(context: AttendanceMembershipContext, requestId: UUID, mutation: () => Promise<WorkSessionRecord>): Promise<WorkSessionDto> {
    return this.transaction(async () => {
      const previous = await this.dependencies.repository.findIdempotentResult(context.organizationId, context.membershipId, requestId);
      if (previous) { if (previous.kind !== "session") throw conflict("Der Idempotency-Key wurde bereits verwendet."); return previous.response as WorkSessionDto; }
      const session = await mutation(); const response = toWorkSessionDto(session);
      await this.dependencies.repository.saveIdempotentResult(context.organizationId, context.membershipId, requestId, { kind: "session", response }); return response;
    });
  }

  private buildDailyOverview(workDate: ISODate, sessions: WorkSessionRecord[], now = toIsoInstant(this.dependencies.clock.now())): DailyAttendanceOverview {
    const dtos = sessions.sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map((item) => toWorkSessionDto(item, now));
    return { workDate, state: deriveAttendanceState(sessions.find((item) => !item.endedAt)), sessions: dtos, workedMinutes: dtos.reduce((n, item) => n + (item.workedMinutes ?? 0), 0), breakMinutes: calculateGapMinutes(dtos) };
  }
  private validateInterval(context: AttendanceMembershipContext, input: CreateWorkSessionRequest) {
    if (Date.parse(input.endedAt) <= Date.parse(input.startedAt)) throw validationError("Das Ende muss nach dem Beginn liegen.", "endedAt");
    if (localDateForInstant(input.startedAt, context.organizationTimeZone) !== input.workDate) throw validationError("Das Arbeitsdatum muss zum Beginn passen.", "workDate");
  }
  private async ensureNoOverlap(context: AttendanceMembershipContext, candidate: WorkSessionRecord, ignoredId?: UUID) {
    const sessions = await this.dependencies.repository.listSessions(context.organizationId, context.membershipId, candidate.workDate, candidate.workDate);
    const start = Date.parse(candidate.startedAt), end = candidate.endedAt ? Date.parse(candidate.endedAt) : Infinity;
    if (sessions.some((item) => item.id !== ignoredId && start < (item.endedAt ? Date.parse(item.endedAt) : Infinity) && Date.parse(item.startedAt) < end)) throw conflict("Arbeitsintervalle dürfen sich nicht überschneiden.", "startedAt");
  }
  private async requireOwnSession(context: AttendanceMembershipContext, id: UUID) { const item = await this.dependencies.repository.findSession(context.organizationId, context.membershipId, id); if (!item) throw validationError("Der eigene Arbeitszeiteintrag wurde nicht gefunden.", "sessionId"); return item; }
  private assertOpen(context: AttendanceMembershipContext, workDate: ISODate, operation: "clock" | "manual") { return this.dependencies.periodGuard.assertPeriodOpen({ organizationId: context.organizationId, membershipId: context.membershipId, workDate, operation }); }
  private audit(context: AttendanceMembershipContext, requestId: UUID, action: string, entity: WorkSessionRecord, beforeValues?: unknown, afterValues?: unknown) { return this.dependencies.repository.appendAuditEvent({ id: this.dependencies.ids.uuid(), organizationId: context.organizationId, actorUserId: context.userId, actorMembershipId: context.membershipId, action, entityType: "work_session", entityId: entity.id, occurredAt: toIsoInstant(this.dependencies.clock.now()), requestId, beforeValues, afterValues }); }
  private transaction<T>(fn: () => Promise<T>) { return this.dependencies.repository.transaction ? this.dependencies.repository.transaction(fn) : fn(); }
}
