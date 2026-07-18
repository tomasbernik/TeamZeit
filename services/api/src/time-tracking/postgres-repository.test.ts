import { describe, expect, it } from "vitest";

import { PostgresPeriodGuard, PostgresTimeTrackingRepository } from "./postgres-repository.js";
import type { StoredCommandResult, WorkSessionRecord } from "./types.js";

interface RpcCall {
  fn: string;
  args?: Record<string, unknown>;
}

interface EqFilter {
  table: string;
  column: string;
  value: string | number | boolean;
}

class FakeQuery<T> implements PromiseLike<{ data: T[] | null; error: { message: string } | null }> {
  public constructor(
    private readonly table: string,
    private readonly rows: T[],
    private readonly filters: EqFilter[],
  ) {}

  public select() {
    return this;
  }

  public eq(column: string, value: string | number | boolean) {
    this.filters.push({ table: this.table, column, value });
    return this;
  }

  public gte() {
    return this;
  }

  public lte() {
    return this;
  }

  public is() {
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

class FakeSupabaseClient {
  public readonly rpcCalls: RpcCall[] = [];
  public readonly eqFilters: EqFilter[] = [];

  public constructor(private readonly tableRows: Record<string, unknown[]> = {}) {}

  public from<T>(table: string) {
    return new FakeQuery<T>(table, (this.tableRows[table] ?? []) as T[], this.eqFilters);
  }

  public async rpc(fn: string, args?: Record<string, unknown>) {
    this.rpcCalls.push(args === undefined ? { fn } : { fn, args });
    return { data: null, error: null };
  }
}

const session: WorkSessionRecord = {
  id: "00000000-0000-4000-8000-000000000101",
  organizationId: "00000000-0000-4000-8000-000000000001",
  membershipId: "00000000-0000-4000-8000-000000000002",
  workDate: "2026-07-16",
  startedAt: "2026-07-16T06:00:00.000Z",
  breaks: [],
  source: "clock",
  version: 1,
};

const idempotentResult: StoredCommandResult = {
  kind: "clock",
  response: {
    serverTime: "2026-07-16T06:00:00.000Z",
    session: {
      ...session,
      breaks: [],
      state: "working",
    },
  },
};

describe("PostgresTimeTrackingRepository", () => {
  it("batches repository writes into one transactional RPC call", async () => {
    const client = new FakeSupabaseClient();
    const repository = new PostgresTimeTrackingRepository(client as never);

    await repository.transaction(async () => {
      await repository.insertSession(session);
      await repository.appendClockEvent({
        id: "00000000-0000-4000-8000-000000000102",
        organizationId: session.organizationId,
        workSessionId: session.id,
        membershipId: session.membershipId,
        eventType: "clock_in",
        occurredAt: "2026-07-16T06:00:00.000Z",
        recordedAt: "2026-07-16T06:00:00.000Z",
        requestId: "00000000-0000-4000-8000-000000000103",
      });
      await repository.saveIdempotentResult(
        session.organizationId,
        session.membershipId,
        "00000000-0000-4000-8000-000000000103",
        idempotentResult,
      );
    });

    expect(client.rpcCalls).toHaveLength(1);
    expect(client.rpcCalls[0]).toMatchObject({ fn: "time_tracking_apply_interval_operations" });
    expect(client.rpcCalls[0]?.args?.operations).toEqual([
      { type: "insert_session", session },
      {
        type: "append_clock_event",
        event: expect.objectContaining({ eventType: "clock_in", organizationId: session.organizationId }),
      },
      {
        type: "save_idempotent_result",
        organizationId: session.organizationId,
        membershipId: session.membershipId,
        requestId: "00000000-0000-4000-8000-000000000103",
        result: idempotentResult,
      },
    ]);
  });

  it("looks up idempotent results by organization, membership and request id", async () => {
    const client = new FakeSupabaseClient({
      time_tracking_idempotency: [{ result: idempotentResult }],
    });
    const repository = new PostgresTimeTrackingRepository(client as never);

    await repository.findIdempotentResult(
      session.organizationId,
      session.membershipId,
      "00000000-0000-4000-8000-000000000103",
    );

    expect(client.eqFilters).toEqual([
      { table: "time_tracking_idempotency", column: "organization_id", value: session.organizationId },
      { table: "time_tracking_idempotency", column: "membership_id", value: session.membershipId },
      { table: "time_tracking_idempotency", column: "request_id", value: "00000000-0000-4000-8000-000000000103" },
    ]);
  });

  it("delegates closed-period checks to the database", async () => {
    const client = new FakeSupabaseClient();
    const guard = new PostgresPeriodGuard(client as never);

    await guard.assertPeriodOpen({
      organizationId: session.organizationId,
      membershipId: session.membershipId,
      workDate: session.workDate,
      operation: "clock",
    });

    expect(client.rpcCalls).toEqual([
      {
        fn: "time_tracking_assert_period_open",
        args: {
          target_organization_id: session.organizationId,
          target_membership_id: session.membershipId,
          target_work_date: session.workDate,
          target_operation: "clock",
        },
      },
    ]);
  });
});
