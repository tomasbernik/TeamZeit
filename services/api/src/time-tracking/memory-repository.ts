import type {
  AuditEventRecord,
  ClockEventRecord,
  CorrectionRecord,
  StoredCommandResult,
  TimeTrackingRepository,
  WorkSessionRecord,
} from "./types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryTimeTrackingRepository implements TimeTrackingRepository {
  public readonly sessions = new Map<string, WorkSessionRecord>();
  public readonly clockEvents: ClockEventRecord[] = [];
  public readonly corrections = new Map<string, CorrectionRecord>();
  public readonly auditEvents: AuditEventRecord[] = [];
  private readonly idempotency = new Map<string, StoredCommandResult>();

  public async findIdempotentResult(
    organizationId: string,
    membershipId: string,
    requestId: string,
  ): Promise<StoredCommandResult | undefined> {
    const result = this.idempotency.get(this.idempotencyKey(organizationId, membershipId, requestId));
    return result ? clone(result) : undefined;
  }

  public async saveIdempotentResult(
    organizationId: string,
    membershipId: string,
    requestId: string,
    result: StoredCommandResult,
  ): Promise<void> {
    this.idempotency.set(this.idempotencyKey(organizationId, membershipId, requestId), clone(result));
  }

  public async findOpenSession(organizationId: string, membershipId: string): Promise<WorkSessionRecord | undefined> {
    const session = [...this.sessions.values()].find(
      (candidate) => candidate.organizationId === organizationId && candidate.membershipId === membershipId && !candidate.endedAt,
    );
    return session ? clone(session) : undefined;
  }

  public async findSession(
    organizationId: string,
    membershipId: string,
    sessionId: string,
  ): Promise<WorkSessionRecord | undefined> {
    const session = this.sessions.get(sessionId);
    if (session?.organizationId !== organizationId || session.membershipId !== membershipId) {
      return undefined;
    }

    return clone(session);
  }

  public async listSessions(
    organizationId: string,
    membershipId: string,
    from: string,
    to: string,
  ): Promise<WorkSessionRecord[]> {
    return [...this.sessions.values()]
      .filter(
        (session) =>
          session.organizationId === organizationId &&
          session.membershipId === membershipId &&
          session.workDate >= from &&
          session.workDate <= to,
      )
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
      .map((session) => clone(session));
  }

  public async insertSession(session: WorkSessionRecord): Promise<void> {
    this.sessions.set(session.id, clone(session));
  }

  public async updateSession(session: WorkSessionRecord): Promise<void> {
    this.sessions.set(session.id, clone(session));
  }

  public async appendClockEvent(event: ClockEventRecord): Promise<void> {
    this.clockEvents.push(clone(event));
  }

  public async insertCorrection(correction: CorrectionRecord): Promise<void> {
    this.corrections.set(correction.id, clone(correction));
  }

  public async findCorrection(organizationId: string, correctionId: string): Promise<CorrectionRecord | undefined> {
    const correction = this.corrections.get(correctionId);
    return correction?.organizationId === organizationId ? clone(correction) : undefined;
  }

  public async updateCorrection(correction: CorrectionRecord): Promise<void> {
    this.corrections.set(correction.id, clone(correction));
  }

  public async appendAuditEvent(event: AuditEventRecord): Promise<void> {
    this.auditEvents.push(clone(event));
  }

  private idempotencyKey(organizationId: string, membershipId: string, requestId: string): string {
    return `${organizationId}:${membershipId}:${requestId}`;
  }
}
