import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

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

  it("denies direct employee writes so interval commands remain server-authoritative", async () => {
    const client = userClient(env, ids.employeeOneUser);
    const { error } = await client.from("work_sessions").insert({
      organization_id: ids.orgNorth,
      membership_id: ids.employeeOneMembership,
      work_date: "2026-07-18",
      started_at: "2026-07-18T06:00:00Z",
      ended_at: "2026-07-18T14:00:00Z",
      source: "manual",
    });

    expect(error).not.toBeNull();
  });
});

describe("Supabase/PostgreSQL time tracking integration", () => {
  it("creates, updates and archives an own interval with an immutable audit trail", async () => {
    const db = serviceClient(env);
    const service = new TimeTrackingService({
      repository: new PostgresTimeTrackingRepository(db),
      periodGuard: new PostgresPeriodGuard(db),
      clock: new QueueClock(
        "2026-07-18T05:00:00.000Z",
        "2026-07-18T05:05:00.000Z",
        "2026-07-18T05:10:00.000Z",
        "2026-07-18T05:10:01.000Z",
      ),
      ids: randomIds,
    });
    const context = {
      organizationId: ids.orgNorth,
      membershipId: ids.employeeTwoMembership,
      userId: ids.employeeTwoUser,
      organizationTimeZone: "Europe/Berlin",
    };

    const created = await service.createSession(context, randomUUID(), {
      workDate: "2026-07-18",
      startedAt: "2026-07-18T06:00:00.000Z",
      endedAt: "2026-07-18T14:00:00.000Z",
    });
    const updated = await service.updateSession(context, created.id, randomUUID(), {
      workDate: "2026-07-18",
      startedAt: "2026-07-18T06:30:00.000Z",
      endedAt: "2026-07-18T14:30:00.000Z",
      expectedVersion: created.version,
    });
    const archived = await service.archiveSession(context, updated.id, randomUUID(), updated.version);
    const audit = await db.from("audit_events").select("action").eq("entity_id", created.id).order("occurred_at");

    expect(created).toMatchObject({ source: "manual", version: 1 });
    expect(updated).toMatchObject({ startedAt: "2026-07-18T06:30:00.000Z", version: 2 });
    expect(archived).toMatchObject({ version: 3 });
    expect(audit.error).toBeNull();
    expect(audit.data?.map((event) => event.action)).toEqual([
      "work_session.created",
      "work_session.updated",
      "work_session.archived",
    ]);
  });

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
        "2026-07-17T14:00:01.000Z",
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
    const day = await service.getDailyOverview(context, "2026-07-17");
    const { data, error } = await db
      .from("clock_events")
      .select("event_type")
      .eq("membership_id", ids.employeeTwoMembership)
      .gte("occurred_at", "2026-07-17T00:00:00.000Z")
      .lt("occurred_at", "2026-07-18T00:00:00.000Z")
      .order("recorded_at", { ascending: true });

    expect(completed.session).toMatchObject({ state: "completed", workedMinutes: 210 });
    expect(day).toMatchObject({ workedMinutes: 450, breakMinutes: 30 });
    expect(day.sessions).toHaveLength(2);
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
