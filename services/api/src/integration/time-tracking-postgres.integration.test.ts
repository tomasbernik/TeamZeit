import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import type { ApiConfig } from "../config/env.js";
import { PostgresPeriodGuard, PostgresTimeTrackingRepository } from "../time-tracking/postgres-repository.js";
import { TimeTrackingService } from "../time-tracking/service.js";
import type { Clock, IdGenerator } from "../time-tracking/types.js";
import { ids, requireLocalSupabase, serviceClient, userClient } from "./supabase-local.js";

const env = requireLocalSupabase();

class QueueClock implements Clock {
  private readonly instants: Date[];

  public constructor(...instants: string[]) {
    this.instants = instants.map((instant) => new Date(instant));
  }

  public now(): Date {
    const instant = this.instants.shift();
    if (!instant) throw new Error("Clock queue is empty.");
    return instant;
  }
}

const randomIds: IdGenerator = {
  uuid: () => randomUUID(),
};

function apiConfig(): ApiConfig {
  return {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 3000,
    webOrigin: "http://127.0.0.1:5173",
    supabaseUrl: env.url,
    supabaseAnonKey: env.publishableKey,
    supabaseServiceRoleKey: env.secretKey,
    supabaseConfigured: true,
    supabaseServiceRoleConfigured: true,
    timeTrackingRepository: "postgres",
  };
}

function contextFor(role: "owner" | "admin" | "manager") {
  const values = {
    owner: { userId: ids.ownerUser, membershipId: ids.ownerMembership },
    admin: { userId: ids.adminUser, membershipId: ids.adminMembership },
    manager: { userId: ids.managerUser, membershipId: ids.managerMembership },
  }[role];

  return {
    createClient: () => ({
      auth: {
        async getUser() {
          return { data: { user: { id: values.userId, email: `${role}@example.test` } }, error: null };
        },
      },
      from(table: string) {
        if (table === "profiles") {
          return fakeQuery([{ display_name: role }]);
        }

        if (table === "memberships") {
          return fakeQuery([
            {
              id: values.membershipId,
              role,
              status: "active",
              employee_number: null,
              organization: {
                id: ids.orgNorth,
                name: "Fiktive Werkstatt Nord",
                slug: "fiktive-werkstatt-nord",
                time_zone: "Europe/Berlin",
                logo_path: null,
              },
            },
          ]);
        }

        throw new Error(`Unexpected table ${table}`);
      },
    }),
  };
}

function fakeQuery<T>(rows: T[]) {
  return {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    order() {
      return this;
    },
    async maybeSingle() {
      return { data: rows[0] ?? null, error: null };
    },
    then<TResult1 = { data: T[]; error: null }, TResult2 = never>(
      onfulfilled?: ((value: { data: T[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve({ data: rows, error: null }).then(onfulfilled, onrejected);
    },
  };
}

async function reviewCorrection(role: "owner" | "admin" | "manager", correctionId: string) {
  const app = buildApp(apiConfig(), { identity: contextFor(role) });

  try {
    return await app.inject({
      method: "POST",
      url: `/api/v1/corrections/${correctionId}/review`,
      headers: {
        authorization: "Bearer local-test-token",
        "x-organization-id": ids.orgNorth,
        "idempotency-key": randomUUID(),
      },
      payload: { decision: "approve", comment: "Lokaler Integrationstest." },
    });
  } finally {
    await app.close();
  }
}

describe("Supabase/PostgreSQL RLS integration", () => {
  it("lets an employee read only their own attendance records", async () => {
    const client = userClient(env, ids.employeeOneUser);
    const { data, error } = await client.from("work_sessions").select("id, membership_id").eq("organization_id", ids.orgNorth);

    expect(error).toBeNull();
    expect(data?.map((row) => row.id).sort()).toEqual([ids.employeeOneSession, "70000000-0000-4000-8000-000000000004"].sort());
    expect(data?.every((row) => row.membership_id === ids.employeeOneMembership)).toBe(true);
  });

  it("does not expose another organization through tenant-owned tables", async () => {
    const client = userClient(env, ids.employeeOneUser);
    const { data, error } = await client.from("work_sessions").select("id").eq("organization_id", ids.orgSouth);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("allows auditor reads but denies auditor writes", async () => {
    const client = userClient(env, ids.auditorUser);
    const read = await client.from("work_sessions").select("id").eq("organization_id", ids.orgNorth);
    const write = await client.from("work_sessions").insert({
      organization_id: ids.orgNorth,
      membership_id: ids.auditorMembership,
      work_date: "2026-07-16",
      started_at: "2026-07-16T06:00:00Z",
      source: "clock",
    });

    expect(read.error).toBeNull();
    expect(read.data?.length).toBeGreaterThanOrEqual(3);
    expect(write.error).not.toBeNull();
  });

  it("denies manager correction review until API scope enforcement exists", async () => {
    const response = await reviewCorrection("manager", ids.pendingCorrectionForAdmin);
    const db = serviceClient(env);
    const { data } = await db
      .from("correction_requests")
      .select("status")
      .eq("id", ids.pendingCorrectionForAdmin)
      .maybeSingle();

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    expect(data?.status).toBe("pending");
  });

  it("allows admin and owner correction review through the real repository", async () => {
    const adminResponse = await reviewCorrection("admin", ids.pendingCorrectionForAdmin);
    const ownerResponse = await reviewCorrection("owner", ids.pendingCorrectionForOwner);

    expect(adminResponse.statusCode).toBe(200);
    expect(adminResponse.json()).toMatchObject({ status: "approved", reviewedByMembershipId: ids.adminMembership });
    expect(ownerResponse.statusCode).toBe(200);
    expect(ownerResponse.json()).toMatchObject({ status: "approved", reviewedByMembershipId: ids.ownerMembership });
  });
});

describe("Supabase/PostgreSQL time tracking integration", () => {
  it("keeps idempotent clock-in atomic by organization, membership and request id", async () => {
    const db = serviceClient(env);
    const service = new TimeTrackingService({
      repository: new PostgresTimeTrackingRepository(db),
      periodGuard: new PostgresPeriodGuard(db),
      clock: new QueueClock("2026-07-16T06:00:00.000Z", "2026-07-16T06:05:00.000Z", "2026-07-16T14:00:00.000Z"),
      ids: randomIds,
    });
    const requestId = randomUUID();
    const context = {
      organizationId: ids.orgNorth,
      membershipId: ids.employeeTwoMembership,
      userId: ids.employeeTwoUser,
      organizationTimeZone: "Europe/Berlin",
    };

    const first = await service.clockIn(context, requestId);
    const duplicate = await service.clockIn(context, requestId);
    const { data, error } = await db.from("time_tracking_idempotency").select("request_id").eq("request_id", requestId);

    expect(duplicate).toEqual(first);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    await service.clockOut(context, randomUUID());
  });

  it("runs clock-in to break to clock-out against the real database", async () => {
    const db = serviceClient(env);
    const service = new TimeTrackingService({
      repository: new PostgresTimeTrackingRepository(db),
      periodGuard: new PostgresPeriodGuard(db),
      clock: new QueueClock(
        "2026-07-17T06:00:00.000Z",
        "2026-07-17T10:00:00.000Z",
        "2026-07-17T10:30:00.000Z",
        "2026-07-17T14:00:00.000Z",
      ),
      ids: randomIds,
    });
    const context = {
      organizationId: ids.orgNorth,
      membershipId: ids.employeeTwoMembership,
      userId: ids.employeeTwoUser,
      organizationTimeZone: "Europe/Berlin",
    };

    await service.clockIn(context, randomUUID());
    await service.startBreak(context, randomUUID());
    await service.endBreak(context, randomUUID());
    const completed = await service.clockOut(context, randomUUID());
    const { data, error } = await db
      .from("clock_events")
      .select("event_type")
      .eq("work_session_id", completed.session.id)
      .order("recorded_at", { ascending: true });

    expect(completed.session).toMatchObject({ state: "completed", workedMinutes: 450 });
    expect(error).toBeNull();
    expect(data?.map((row) => row.event_type)).toEqual(["clock_in", "break_start", "break_end", "clock_out"]);
  });

  it("prevents changing or deleting historical clock and audit events", async () => {
    const db = serviceClient(env);
    const clockUpdate = await db.from("clock_events").update({ metadata: { tampered: true } }).eq("id", ids.employeeOneClockEvent);
    const clockDelete = await db.from("clock_events").delete().eq("id", ids.employeeOneClockEvent);
    const auditUpdate = await db.from("audit_events").update({ metadata: { tampered: true } }).eq("id", ids.seedAuditEvent);
    const auditDelete = await db.from("audit_events").delete().eq("id", ids.seedAuditEvent);

    expect(clockUpdate.error?.message).toContain("append_only_history");
    expect(clockDelete.error?.message).toContain("append_only_history");
    expect(auditUpdate.error?.message).toContain("append_only_history");
    expect(auditDelete.error?.message).toContain("append_only_history");
  });
});
