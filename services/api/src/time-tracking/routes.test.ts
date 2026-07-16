import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { readApiConfig } from "../config/env.js";
import { InMemoryTimeTrackingRepository } from "./memory-repository.js";
import { TimeTrackingService } from "./service.js";
import type { Clock, CorrectionRecord, IdGenerator, PeriodGuard, WorkSessionRecord } from "./types.js";

const userId = "00000000-0000-4000-8000-000000000001";
const membershipId = "00000000-0000-4000-8000-000000000002";
const auditorMembershipId = "00000000-0000-4000-8000-000000000003";
const inactiveMembershipId = "00000000-0000-4000-8000-000000000004";
const otherMembershipId = "00000000-0000-4000-8000-000000000005";
const organizationId = "00000000-0000-4000-8000-000000000011";
const otherOrganizationId = "00000000-0000-4000-8000-000000000012";

const testConfig = readApiConfig({
  NODE_ENV: "test",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "publishable-key",
});

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

interface FakeMembership {
  id: string;
  role: "owner" | "admin" | "manager" | "employee" | "auditor";
  status: "invited" | "active" | "inactive";
  employee_number: string | null;
  organization: {
    id: string;
    name: string;
    slug: string;
    time_zone: string;
    logo_path: string | null;
  };
}

class FakeQuery<T> implements PromiseLike<{ data: T[] | null; error: { message: string } | null }> {
  public constructor(private readonly rows: T[]) {}

  public select() {
    return this;
  }

  public eq() {
    return this;
  }

  public order() {
    return this;
  }

  public async maybeSingle() {
    return { data: this.rows[0] ?? null, error: null };
  }

  public then<TResult1 = { data: T[] | null; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: T[] | null; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.rows, error: null }).then(onfulfilled, onrejected);
  }
}

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

class SequenceIds implements IdGenerator {
  private next = 100;

  public uuid(): string {
    const suffix = String(this.next++).padStart(12, "0");
    return `00000000-0000-4000-8000-${suffix}`;
  }
}

const openPeriodGuard: PeriodGuard = {
  async assertPeriodOpen() {
    return undefined;
  },
};

function membership(overrides: Partial<FakeMembership> = {}): FakeMembership {
  return {
    id: membershipId,
    role: "employee",
    status: "active",
    employee_number: "E-1",
    organization: {
      id: organizationId,
      name: "Example Org",
      slug: "example",
      time_zone: "Europe/Berlin",
      logo_path: null,
    },
    ...overrides,
  };
}

function buildHarness({
  memberships = [membership()],
  clock = new QueueClock("2026-07-16T06:00:00.000Z"),
  authenticated = true,
}: {
  memberships?: FakeMembership[];
  clock?: Clock;
  authenticated?: boolean;
} = {}) {
  const repository = new InMemoryTimeTrackingRepository();
  const service = new TimeTrackingService({
    repository,
    periodGuard: openPeriodGuard,
    clock,
    ids: new SequenceIds(),
  });
  const identity = {
    createClient: () => ({
      auth: {
        async getUser() {
          if (!authenticated) {
            return { data: { user: null }, error: { message: "invalid" } };
          }

          return { data: { user: { id: userId, email: "person@example.test" } }, error: null };
        },
      },
      from(table: string) {
        if (table === "profiles") return new FakeQuery([{ display_name: "Test User" }]);
        if (table === "memberships") return new FakeQuery(memberships);
        throw new Error(`Unexpected table ${table}`);
      },
    }),
  };
  const app = buildApp(testConfig, { identity, timeTracking: { identity, service } });
  apps.push(app);

  return { app, repository };
}

function authHeaders(extra: Record<string, string> = {}) {
  return {
    authorization: "Bearer valid-token",
    "x-organization-id": organizationId,
    ...extra,
  };
}

describe("time tracking API routes", () => {
  it("rejects attendance requests without authentication", async () => {
    const { app } = buildHarness();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/attendance/today",
      headers: { "x-organization-id": organizationId },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("rejects attendance requests with an invalid bearer token", async () => {
    const { app } = buildHarness({ authenticated: false });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/attendance/today",
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("requires the organization selector header", async () => {
    const { app } = buildHarness();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/attendance/today",
      headers: { authorization: "Bearer valid-token" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "FORBIDDEN", field: "X-Organization-Id" } });
  });

  it("requires a server-verified active organization membership", async () => {
    const inactive = buildHarness({ memberships: [membership({ status: "inactive", id: inactiveMembershipId })] });
    const inactiveResponse = await inactive.app.inject({
      method: "GET",
      url: "/api/v1/attendance/today",
      headers: authHeaders(),
    });

    const wrongOrg = buildHarness();
    const wrongOrgResponse = await wrongOrg.app.inject({
      method: "GET",
      url: "/api/v1/attendance/today",
      headers: authHeaders({ "x-organization-id": otherOrganizationId }),
    });

    expect(inactiveResponse.statusCode).toBe(403);
    expect(wrongOrgResponse.statusCode).toBe(403);
  });

  it("records clock commands for the authenticated member and deduplicates retries", async () => {
    const { app, repository } = buildHarness({
      clock: new QueueClock(
        "2026-07-16T06:00:00.000Z",
        "2026-07-16T10:00:00.000Z",
        "2026-07-16T10:30:00.000Z",
        "2026-07-16T14:00:00.000Z",
        "2026-07-16T15:00:00.000Z",
        "2026-07-16T15:01:00.000Z",
        "2026-07-16T15:02:00.000Z",
      ),
    });

    const requestId = "00000000-0000-4000-8000-000000000201";
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/attendance/commands/clock-in",
      headers: authHeaders({ "idempotency-key": requestId }),
    });
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/attendance/commands/clock-in",
      headers: authHeaders({ "idempotency-key": requestId }),
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/attendance/commands/break-start",
      headers: authHeaders({ "idempotency-key": "00000000-0000-4000-8000-000000000202" }),
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/attendance/commands/break-end",
      headers: authHeaders({ "idempotency-key": "00000000-0000-4000-8000-000000000203" }),
    });
    const clockOut = await app.inject({
      method: "POST",
      url: "/api/v1/attendance/commands/clock-out",
      headers: authHeaders({ "idempotency-key": "00000000-0000-4000-8000-000000000204" }),
    });
    const day = await app.inject({
      method: "GET",
      url: "/api/v1/attendance/days/2026-07-16",
      headers: authHeaders(),
    });
    const sessions = await app.inject({
      method: "GET",
      url: "/api/v1/attendance/sessions?from=2026-07-16&to=2026-07-16",
      headers: authHeaders(),
    });
    const month = await app.inject({
      method: "GET",
      url: "/api/v1/attendance/months/2026-07",
      headers: authHeaders(),
    });

    expect(first.statusCode).toBe(200);
    expect(duplicate.json()).toEqual(first.json());
    expect(repository.clockEvents).toHaveLength(4);
    expect(clockOut.json().session).toMatchObject({ state: "completed", workedMinutes: 450, membershipId });
    expect(day.json()).toMatchObject({ workDate: "2026-07-16", workedMinutes: 450, breakMinutes: 30 });
    expect(sessions.json().items).toHaveLength(1);
    expect(sessions.json().items[0]).toMatchObject({ membershipId, workedMinutes: 450 });
    expect(month.json()).toMatchObject({ month: "2026-07", workedMinutes: 450, breakMinutes: 30 });
  });

  it("requires idempotency keys and blocks auditor writes", async () => {
    const missingKey = buildHarness();
    const missingKeyResponse = await missingKey.app.inject({
      method: "POST",
      url: "/api/v1/attendance/commands/clock-in",
      headers: authHeaders(),
    });

    const auditor = buildHarness({ memberships: [membership({ id: auditorMembershipId, role: "auditor" })] });
    const auditorResponse = await auditor.app.inject({
      method: "POST",
      url: "/api/v1/attendance/commands/clock-in",
      headers: authHeaders({ "idempotency-key": "00000000-0000-4000-8000-000000000211" }),
    });

    expect(missingKeyResponse.statusCode).toBe(400);
    expect(missingKeyResponse.json()).toMatchObject({ error: { code: "VALIDATION_ERROR", field: "Idempotency-Key" } });
    expect(auditorResponse.statusCode).toBe(403);
    expect(auditorResponse.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("does not allow corrections against another employee session", async () => {
    const { app, repository } = buildHarness({ clock: new QueueClock("2026-07-16T15:00:00.000Z") });
    const otherSession: WorkSessionRecord = {
      id: "00000000-0000-4000-8000-000000000301",
      organizationId,
      membershipId: otherMembershipId,
      workDate: "2026-07-16",
      startedAt: "2026-07-16T06:00:00.000Z",
      endedAt: "2026-07-16T14:00:00.000Z",
      breaks: [],
      source: "clock",
      version: 2,
    };
    await repository.insertSession(otherSession);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/corrections",
      headers: authHeaders({ "idempotency-key": "00000000-0000-4000-8000-000000000212" }),
      payload: {
        sessionId: otherSession.id,
        expectedVersion: 2,
        proposed: {
          workDate: "2026-07-16",
          startedAt: "2026-07-16T06:15:00.000Z",
          endedAt: "2026-07-16T14:00:00.000Z",
          breakMinutes: 30,
        },
        reason: "Forgot to record a correction.",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR", field: "sessionId" } });
    expect(repository.corrections.size).toBe(0);
  });

  it("blocks correction review for roles without review capability", async () => {
    const { app, repository } = buildHarness();
    const correction: CorrectionRecord = {
      id: "00000000-0000-4000-8000-000000000401",
      organizationId,
      requesterMembershipId: otherMembershipId,
      sessionId: "00000000-0000-4000-8000-000000000402",
      original: {
        workDate: "2026-07-16",
        startedAt: "2026-07-16T06:00:00.000Z",
        endedAt: "2026-07-16T14:00:00.000Z",
        breakMinutes: 0,
      },
      proposed: {
        workDate: "2026-07-16",
        startedAt: "2026-07-16T06:15:00.000Z",
        endedAt: "2026-07-16T14:00:00.000Z",
        breakMinutes: 30,
      },
      reason: "Correction requested.",
      status: "pending",
      createdAt: "2026-07-16T15:00:00.000Z",
      expectedVersion: 2,
    };
    await repository.insertCorrection(correction);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/corrections/${correction.id}/review`,
      headers: authHeaders({ "idempotency-key": "00000000-0000-4000-8000-000000000213" }),
      payload: { decision: "approve" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    expect((await repository.findCorrection(organizationId, correction.id))?.status).toBe("pending");
  });

  it("blocks manager correction review until manager scope enforcement exists", async () => {
    const { app, repository } = buildHarness({ memberships: [membership({ role: "manager" })] });
    const correction: CorrectionRecord = {
      id: "00000000-0000-4000-8000-000000000411",
      organizationId,
      requesterMembershipId: otherMembershipId,
      sessionId: "00000000-0000-4000-8000-000000000412",
      original: {
        workDate: "2026-07-16",
        startedAt: "2026-07-16T06:00:00.000Z",
        endedAt: "2026-07-16T14:00:00.000Z",
        breakMinutes: 0,
      },
      proposed: {
        workDate: "2026-07-16",
        startedAt: "2026-07-16T06:15:00.000Z",
        endedAt: "2026-07-16T14:00:00.000Z",
        breakMinutes: 30,
      },
      reason: "Correction requested.",
      status: "pending",
      createdAt: "2026-07-16T15:00:00.000Z",
      expectedVersion: 2,
    };
    await repository.insertCorrection(correction);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/corrections/${correction.id}/review`,
      headers: authHeaders({ "idempotency-key": "00000000-0000-4000-8000-000000000214" }),
      payload: { decision: "approve" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    expect((await repository.findCorrection(organizationId, correction.id))?.status).toBe("pending");
  });
});
