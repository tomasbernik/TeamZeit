import { describe, expect, it } from "vitest";

import { TimeTrackingError } from "./errors.js";
import { TimeTrackingService } from "./service.js";
import type {
  AttendanceMembershipContext,
  AuditEventRecord,
  Clock,
  ClockEventRecord,
  CorrectionRecord,
  PeriodGuard,
  StoredCommandResult,
  TimeTrackingRepository,
  WorkSessionRecord,
} from "./types.js";

const organizationId = "00000000-0000-4000-8000-000000000001";
const membershipId = "00000000-0000-4000-8000-000000000002";
const managerMembershipId = "00000000-0000-4000-8000-000000000003";
const userId = "00000000-0000-4000-8000-000000000004";

class QueueClock implements Clock {
  private readonly instants: Date[];

  public constructor(...instants: string[]) {
    this.instants = instants.map((instant) => new Date(instant));
  }

  public now(): Date {
    const instant = this.instants.shift();
    if (!instant) {
      throw new Error("Test clock queue is empty");
    }

    return instant;
  }
}

class SequenceIds {
  private next = 10;

  public uuid(): string {
    const suffix = String(this.next++).padStart(12, "0");
    return `00000000-0000-4000-8000-${suffix}`;
  }
}

class OpenPeriodGuard implements PeriodGuard {
  public readonly checks: Array<{ workDate: string; operation: string }> = [];

  public async assertPeriodOpen(input: { workDate: string; operation: "clock" | "correction" }): Promise<void> {
    this.checks.push(input);
  }
}

class MemoryTimeTrackingRepository implements TimeTrackingRepository {
  public readonly sessions = new Map<string, WorkSessionRecord>();
  public readonly clockEvents: ClockEventRecord[] = [];
  public readonly corrections = new Map<string, CorrectionRecord>();
  public readonly auditEvents: AuditEventRecord[] = [];
  private readonly idempotency = new Map<string, StoredCommandResult>();

  public async findIdempotentResult(
    organizationIdValue: string,
    membershipIdValue: string,
    requestId: string,
  ): Promise<StoredCommandResult | undefined> {
    return this.idempotency.get(`${organizationIdValue}:${membershipIdValue}:${requestId}`);
  }

  public async saveIdempotentResult(
    organizationIdValue: string,
    membershipIdValue: string,
    requestId: string,
    result: StoredCommandResult,
  ): Promise<void> {
    this.idempotency.set(`${organizationIdValue}:${membershipIdValue}:${requestId}`, result);
  }

  public async findOpenSession(organizationIdValue: string, membershipIdValue: string): Promise<WorkSessionRecord | undefined> {
    return [...this.sessions.values()].find(
      (session) =>
        session.organizationId === organizationIdValue && session.membershipId === membershipIdValue && !session.endedAt,
    );
  }

  public async findSession(
    organizationIdValue: string,
    membershipIdValue: string,
    sessionId: string,
  ): Promise<WorkSessionRecord | undefined> {
    const session = this.sessions.get(sessionId);
    return session?.organizationId === organizationIdValue && session.membershipId === membershipIdValue ? session : undefined;
  }

  public async listSessions(
    organizationIdValue: string,
    membershipIdValue: string,
    from: string,
    to: string,
  ): Promise<WorkSessionRecord[]> {
    return [...this.sessions.values()].filter(
      (session) =>
        session.organizationId === organizationIdValue &&
        session.membershipId === membershipIdValue &&
        session.workDate >= from &&
        session.workDate <= to,
    );
  }

  public async insertSession(session: WorkSessionRecord): Promise<void> {
    this.sessions.set(session.id, session);
  }

  public async updateSession(session: WorkSessionRecord): Promise<void> {
    this.sessions.set(session.id, session);
  }

  public async appendClockEvent(event: ClockEventRecord): Promise<void> {
    this.clockEvents.push(event);
  }

  public async insertCorrection(correction: CorrectionRecord): Promise<void> {
    this.corrections.set(correction.id, correction);
  }

  public async findCorrection(organizationIdValue: string, correctionId: string): Promise<CorrectionRecord | undefined> {
    const correction = this.corrections.get(correctionId);
    return correction?.organizationId === organizationIdValue ? correction : undefined;
  }

  public async updateCorrection(correction: CorrectionRecord): Promise<void> {
    this.corrections.set(correction.id, correction);
  }

  public async appendAuditEvent(event: AuditEventRecord): Promise<void> {
    this.auditEvents.push(event);
  }
}

function buildHarness(clock: Clock) {
  const repository = new MemoryTimeTrackingRepository();
  const periodGuard = new OpenPeriodGuard();
  const service = new TimeTrackingService({
    repository,
    periodGuard,
    clock,
    ids: new SequenceIds(),
  });
  const context: AttendanceMembershipContext = {
    organizationId,
    membershipId,
    userId,
    organizationTimeZone: "Europe/Berlin",
  };

  return { service, repository, periodGuard, context };
}

function expectTimeTrackingError(error: unknown, code: string) {
  expect(error).toBeInstanceOf(TimeTrackingError);
  expect((error as TimeTrackingError).code).toBe(code);
}

describe("time tracking domain service", () => {
  it("records clock in, break start, break end and clock out with worked minutes", async () => {
    const { service, repository, context } = buildHarness(
      new QueueClock(
        "2026-07-16T06:00:00.000Z",
        "2026-07-16T10:00:00.000Z",
        "2026-07-16T10:30:00.000Z",
        "2026-07-16T14:00:00.000Z",
      ),
    );

    await service.clockIn(context, "00000000-0000-4000-8000-000000000101");
    await service.startBreak(context, "00000000-0000-4000-8000-000000000102");
    await service.endBreak(context, "00000000-0000-4000-8000-000000000103");
    const result = await service.clockOut(context, "00000000-0000-4000-8000-000000000104");

    expect(result.session.state).toBe("completed");
    expect(result.session.workDate).toBe("2026-07-16");
    expect(result.session.breaks).toHaveLength(1);
    expect(result.session.breaks[0]?.durationMinutes).toBe(30);
    expect(result.session.workedMinutes).toBe(450);
    expect(repository.clockEvents.map((event) => event.eventType)).toEqual([
      "clock_in",
      "break_start",
      "break_end",
      "clock_out",
    ]);
  });

  it("calculates worked time across multiple breaks", async () => {
    const { service, context } = buildHarness(
      new QueueClock(
        "2026-07-16T06:00:00.000Z",
        "2026-07-16T08:00:00.000Z",
        "2026-07-16T08:15:00.000Z",
        "2026-07-16T11:00:00.000Z",
        "2026-07-16T11:30:00.000Z",
        "2026-07-16T14:00:00.000Z",
        "2026-07-16T15:00:00.000Z",
      ),
    );

    await service.clockIn(context, "00000000-0000-4000-8000-000000000171");
    await service.startBreak(context, "00000000-0000-4000-8000-000000000172");
    await service.endBreak(context, "00000000-0000-4000-8000-000000000173");
    await service.startBreak(context, "00000000-0000-4000-8000-000000000174");
    await service.endBreak(context, "00000000-0000-4000-8000-000000000175");
    await service.clockOut(context, "00000000-0000-4000-8000-000000000176");
    const day = await service.getDailyOverview(context, "2026-07-16");

    expect(day.breakMinutes).toBe(45);
    expect(day.workedMinutes).toBe(435);
    expect(day.sessions[0]?.breaks.map((workBreak) => workBreak.durationMinutes)).toEqual([15, 30]);
  });

  it("rejects invalid operation ordering on the server side", async () => {
    const { service, context } = buildHarness(
      new QueueClock(
        "2026-07-16T06:00:00.000Z",
        "2026-07-16T06:01:00.000Z",
        "2026-07-16T06:02:00.000Z",
        "2026-07-16T06:03:00.000Z",
      ),
    );

    await expect(service.startBreak(context, "00000000-0000-4000-8000-000000000111")).rejects.toSatisfy((error) => {
      expectTimeTrackingError(error, "INVALID_STATE");
      return true;
    });

    await service.clockIn(context, "00000000-0000-4000-8000-000000000112");
    await service.startBreak(context, "00000000-0000-4000-8000-000000000113");

    await expect(service.clockOut(context, "00000000-0000-4000-8000-000000000114")).rejects.toSatisfy((error) => {
      expectTimeTrackingError(error, "INVALID_STATE");
      return true;
    });
  });

  it("keeps cross-midnight sessions on the organization-local start date", async () => {
    const { service, context } = buildHarness(
      new QueueClock("2026-07-15T21:30:00.000Z", "2026-07-16T01:30:00.000Z"),
    );

    await service.clockIn(context, "00000000-0000-4000-8000-000000000121");
    const result = await service.clockOut(context, "00000000-0000-4000-8000-000000000122");

    expect(result.session.workDate).toBe("2026-07-15");
    expect(result.session.workedMinutes).toBe(240);
  });

  it("uses the selected organization time zone for work dates", async () => {
    const { service, context } = buildHarness(new QueueClock("2026-07-16T03:30:00.000Z"));

    const result = await service.clockIn(
      { ...context, organizationTimeZone: "America/New_York" },
      "00000000-0000-4000-8000-000000000131",
    );

    expect(result.session.workDate).toBe("2026-07-15");
  });

  it("calculates elapsed minutes across a daylight-saving transition", async () => {
    const { service, context } = buildHarness(
      new QueueClock("2026-03-29T00:30:00.000Z", "2026-03-29T02:30:00.000Z"),
    );

    await service.clockIn(context, "00000000-0000-4000-8000-000000000181");
    const result = await service.clockOut(context, "00000000-0000-4000-8000-000000000182");

    expect(result.session.workDate).toBe("2026-03-29");
    expect(result.session.workedMinutes).toBe(120);
  });

  it("returns the original result for duplicate clicks with the same idempotency key", async () => {
    const { service, repository, context } = buildHarness(
      new QueueClock("2026-07-16T06:00:00.000Z", "2026-07-16T06:01:00.000Z"),
    );
    const requestId = "00000000-0000-4000-8000-000000000141";

    const first = await service.clockIn(context, requestId);
    const second = await service.clockIn(context, requestId);

    expect(second).toEqual(first);
    expect(repository.sessions.size).toBe(1);
    expect(repository.clockEvents).toHaveLength(1);

    await expect(service.clockIn(context, "00000000-0000-4000-8000-000000000142")).rejects.toSatisfy((error) => {
      expectTimeTrackingError(error, "INVALID_STATE");
      return true;
    });
  });

  it("does not reuse idempotent clock results across memberships in the same organization", async () => {
    const { service, repository, context } = buildHarness(
      new QueueClock("2026-07-16T06:00:00.000Z", "2026-07-16T07:00:00.000Z"),
    );
    const requestId = "00000000-0000-4000-8000-000000000143";
    const otherContext = { ...context, membershipId: managerMembershipId };

    const first = await service.clockIn(context, requestId);
    const second = await service.clockIn(otherContext, requestId);

    expect(second.session.membershipId).toBe(managerMembershipId);
    expect(second.session.id).not.toBe(first.session.id);
    expect(repository.sessions.size).toBe(2);
    expect(repository.clockEvents).toHaveLength(2);
  });

  it("builds daily and monthly overviews from completed sessions", async () => {
    const { service, context } = buildHarness(
      new QueueClock(
        "2026-07-16T06:00:00.000Z",
        "2026-07-16T14:00:00.000Z",
        "2026-07-16T15:00:00.000Z",
        "2026-07-17T06:00:00.000Z",
        "2026-07-17T10:00:00.000Z",
        "2026-07-17T11:00:00.000Z",
      ),
    );

    await service.clockIn(context, "00000000-0000-4000-8000-000000000151");
    await service.clockOut(context, "00000000-0000-4000-8000-000000000152");
    const day = await service.getDailyOverview(context, "2026-07-16");
    const month = await service.getMonthlyOverview(context, "2026-07");

    expect(day.workedMinutes).toBe(480);
    expect(day.state).toBe("not_started");
    expect(month.workedMinutes).toBe(480);
    expect(month.days.map((item) => item.workDate)).toEqual(["2026-07-16"]);
  });

  it("submits and approves a correction without allowing requester self-review", async () => {
    const { service, repository, context } = buildHarness(
      new QueueClock(
        "2026-07-16T06:00:00.000Z",
        "2026-07-16T14:00:00.000Z",
        "2026-07-16T15:00:00.000Z",
        "2026-07-16T15:05:00.000Z",
      ),
    );

    const session = (await service.clockIn(context, "00000000-0000-4000-8000-000000000161")).session;
    await service.clockOut(context, "00000000-0000-4000-8000-000000000162");

    const correction = await service.createCorrection(context, "00000000-0000-4000-8000-000000000163", {
      sessionId: session.id,
      expectedVersion: 2,
      proposed: {
        workDate: "2026-07-16",
        startedAt: "2026-07-16T06:15:00.000Z",
        endedAt: "2026-07-16T14:00:00.000Z",
        breakMinutes: 45,
      },
      reason: "Forgot to record the longer lunch break.",
    });

    await expect(
      service.reviewCorrection(
        { ...context, canReviewCorrections: true },
        correction.id,
        "00000000-0000-4000-8000-000000000164",
        { decision: "approve" },
      ),
    ).rejects.toSatisfy((error) => {
      expectTimeTrackingError(error, "CONFLICT");
      return true;
    });

    const reviewed = await service.reviewCorrection(
      { ...context, membershipId: managerMembershipId, canReviewCorrections: true },
      correction.id,
      "00000000-0000-4000-8000-000000000165",
      { decision: "approve", comment: "Checked against the request." },
    );

    const correctedSession = [...repository.sessions.values()][0];
    expect(reviewed.status).toBe("approved");
    expect(correctedSession?.source).toBe("approved_correction");
    expect(correctedSession?.version).toBe(3);
    expect(repository.auditEvents).toHaveLength(1);
    expect(repository.auditEvents[0]?.action).toBe("correction.approved");
  });

  it("keeps approved aggregate correction breaks inside the corrected interval", async () => {
    const { service, repository, context } = buildHarness(
      new QueueClock(
        "2026-07-16T06:00:00.000Z",
        "2026-07-16T07:00:00.000Z",
        "2026-07-16T08:00:00.000Z",
        "2026-07-16T08:05:00.000Z",
      ),
    );

    const session = (await service.clockIn(context, "00000000-0000-4000-8000-000000000191")).session;
    await service.clockOut(context, "00000000-0000-4000-8000-000000000192");
    const correction = await service.createCorrection(context, "00000000-0000-4000-8000-000000000193", {
      sessionId: session.id,
      expectedVersion: 2,
      proposed: {
        workDate: "2026-07-16",
        startedAt: "2026-07-16T06:00:00.000Z",
        endedAt: "2026-07-16T07:00:00.000Z",
        breakMinutes: 60,
      },
      reason: "Correct the whole interval to break time.",
    });

    await service.reviewCorrection(
      { ...context, membershipId: managerMembershipId, canReviewCorrections: true },
      correction.id,
      "00000000-0000-4000-8000-000000000194",
      { decision: "approve" },
    );

    const correctedSession = [...repository.sessions.values()][0];
    expect(correctedSession?.breaks[0]?.startedAt).toBe("2026-07-16T06:00:00.000Z");
    expect(correctedSession?.breaks[0]?.endedAt).toBe("2026-07-16T07:00:00.000Z");
  });
});
