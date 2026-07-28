import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PostgresEmployeeAdministrationRepository } from "../identity/postgres-administration-repository.js";
import { PostgresTimeTrackingRepository } from "../time-tracking/postgres-repository.js";
import { ids, requireLocalSupabase, serviceClient, userClient } from "./supabase-local.js";

const env = requireLocalSupabase();

describe("Supabase/PostgreSQL employee administration integration", () => {
  it("creates an invited membership idempotently and writes one audit event", async () => {
    const db = serviceClient(env);
    const repository = new PostgresEmployeeAdministrationRepository(db);
    const requestId = randomUUID();
    const email = `integration-${requestId}@example.test`;
    const actor = {
      organizationId: ids.orgNorth,
      membershipId: ids.adminMembership,
      userId: ids.adminUser,
      role: "admin" as const,
    };

    const created = await repository.create(actor, { email, role: "employee", idempotencyKey: requestId });
    const duplicate = await repository.create(actor, { email, role: "employee", idempotencyKey: requestId });
    const audit = await db.from("audit_events").select("action, entity_id").eq("request_id", requestId);

    expect(duplicate).toEqual(created);
    expect(created).toMatchObject({ email, role: "employee", status: "invited", version: 1 });
    expect(audit.data).toEqual([{ action: "membership.create", entity_id: created.id }]);
  });

  it("keeps membership reads tenant-scoped through RLS", async () => {
    const employee = userClient(env, ids.employeeOneUser);
    const colleague = await employee
      .from("memberships")
      .select("id")
      .eq("organization_id", ids.orgNorth)
      .eq("id", ids.employeeTwoMembership);
    const foreign = await employee
      .from("memberships")
      .select("id")
      .eq("organization_id", ids.orgSouth);

    expect(colleague.error).toBeNull();
    expect(colleague.data).toEqual([]);
    expect(foreign.error).toBeNull();
    expect(foreign.data).toEqual([]);
  });

  it("rejects a non-admin actor at the database boundary", async () => {
    const repository = new PostgresEmployeeAdministrationRepository(serviceClient(env));
    await expect(repository.create({
      organizationId: ids.orgNorth,
      membershipId: ids.employeeOneMembership,
      userId: ids.employeeOneUser,
      role: "employee",
    }, {
      email: `forbidden-${randomUUID()}@example.test`,
      role: "employee",
      idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("updates a work rule on the same effective date without creating an overlap", async () => {
    const db = serviceClient(env);
    const repository = new PostgresTimeTrackingRepository(db);
    const input = {
      effectiveFrom: "2026-08-01",
      weekdayMinutes: { monday: 360, tuesday: 360, wednesday: 360, thursday: 360, friday: 300, saturday: 0, sunday: 0 },
    };
    const audit = (id: string, requestId: string) => ({
      id,
      organizationId: ids.orgNorth,
      actorUserId: ids.adminUser,
      actorMembershipId: ids.adminMembership,
      action: "employee_work_rule.set",
      entityType: "employee_work_rule",
      entityId: id,
      occurredAt: "2026-07-28T12:00:00.000Z",
      requestId,
      afterValues: input,
      metadata: { targetMembershipId: ids.employeeTwoMembership },
    });
    const created = await repository.setEmployeeWorkRule(ids.orgNorth, ids.employeeTwoMembership, randomUUID(), input, audit(randomUUID(), randomUUID()));
    const updated = await repository.setEmployeeWorkRule(ids.orgNorth, ids.employeeTwoMembership, randomUUID(), {
      ...input,
      weekdayMinutes: { ...input.weekdayMinutes, friday: 240 },
    }, audit(randomUUID(), randomUUID()));

    expect(updated.weekdayMinutes.friday).toBe(240);
    expect(updated.id).toBe(created.id);
  });
});
