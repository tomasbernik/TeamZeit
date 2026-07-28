import { describe, expect, it } from "vitest";
import { PostgresEmployeeAdministrationRepository } from "./postgres-administration-repository.js";

class FakeQuery implements PromiseLike<{ data: unknown[]; error: null }> {
  public readonly filters: Array<[string, string]> = [];
  public select() { return this; }
  public eq(column: string, value: string) { this.filters.push([column, value]); return this; }
  public order() { return this; }
  public then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected);
  }
}

class FakeClient {
  public readonly query = new FakeQuery();
  public readonly calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  public from() { return this.query; }
  public async rpc(fn: string, args: Record<string, unknown>) {
    this.calls.push({ fn, args });
    return { data: { id: "00000000-0000-4000-8000-000000000010", email: "employee@example.test", role: "employee", status: "invited", work_policy_id: null, version: 1, invitation_sent_at: null }, error: null };
  }
}

const actor = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  membershipId: "00000000-0000-4000-8000-000000000002",
  userId: "00000000-0000-4000-8000-000000000003",
  role: "admin" as const,
};

describe("PostgresEmployeeAdministrationRepository", () => {
  it("filters employee lists by organization", async () => {
    const client = new FakeClient();
    const repository = new PostgresEmployeeAdministrationRepository(client as never);
    await repository.list(actor.organizationId);
    expect(client.query.filters).toEqual([["organization_id", actor.organizationId]]);
  });

  it("delegates privileged creation to the audited database command", async () => {
    const client = new FakeClient();
    const repository = new PostgresEmployeeAdministrationRepository(client as never);
    await repository.create(actor, {
      email: "employee@example.test",
      role: "employee",
      idempotencyKey: "00000000-0000-4000-8000-000000000004",
    });
    expect(client.calls).toEqual([{
      fn: "employee_administration_apply",
      args: {
        target_organization_id: actor.organizationId,
        actor_membership_id: actor.membershipId,
        actor_user_id: actor.userId,
        command_operation: "create",
        command_request_id: "00000000-0000-4000-8000-000000000004",
        command: { email: "employee@example.test", role: "employee" },
      },
    }]);
  });
});
