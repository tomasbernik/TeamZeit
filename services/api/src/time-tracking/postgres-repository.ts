import { AsyncLocalStorage } from "node:async_hooks";

import type { SupabaseClient } from "@supabase/supabase-js";

import { TimeTrackingError, conflict } from "./errors.js";
import type {
  AuditEventRecord,
  ClockEventRecord,
  StoredCommandResult,
  TimeTrackingRepository,
  WorkBreakRecord,
  WorkSessionRecord,
} from "./types.js";

interface SupabaseResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

interface QueryBuilder<T> extends PromiseLike<SupabaseResult<T[]>> {
  select(columns: string): QueryBuilder<T>;
  eq(column: string, value: string | number | boolean): QueryBuilder<T>;
  gte(column: string, value: string): QueryBuilder<T>;
  lte(column: string, value: string): QueryBuilder<T>;
  is(column: string, value: null): QueryBuilder<T>;
  order(column: string, options?: { ascending?: boolean; foreignTable?: string }): QueryBuilder<T>;
  maybeSingle(): Promise<SupabaseResult<T>>;
}

interface RpcClient {
  from<T = unknown>(table: string): QueryBuilder<T>;
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<SupabaseResult<T>>;
}

interface WorkBreakRow {
  id: string;
  organization_id: string;
  work_session_id: string;
  started_at: string;
  ended_at: string | null;
}

interface WorkSessionRow {
  id: string;
  organization_id: string;
  membership_id: string;
  work_date: string;
  started_at: string;
  ended_at: string | null;
  source: "clock" | "manual" | "admin_import";
  version: number;
  archived_at: string | null;
  work_breaks?: WorkBreakRow[] | null;
}

type WriteOperation =
  | { type: "insert_session"; session: WorkSessionRecord }
  | { type: "update_session"; session: WorkSessionRecord }
  | { type: "append_clock_event"; event: ClockEventRecord }
  | { type: "append_audit_event"; event: AuditEventRecord }
  | {
      type: "save_idempotent_result";
      organizationId: string;
      membershipId: string;
      requestId: string;
      result: StoredCommandResult;
    };

interface TransactionState {
  operations: WriteOperation[];
}

const sessionColumns =
  "id, organization_id, membership_id, work_date, started_at, ended_at, source, version, archived_at, work_breaks(id, organization_id, work_session_id, started_at, ended_at)";

export class PostgresTimeTrackingRepository implements TimeTrackingRepository {
  private readonly client: RpcClient;
  private readonly transactions = new AsyncLocalStorage<TransactionState>();

  public constructor(client: SupabaseClient) {
    this.client = client as unknown as RpcClient;
  }

  public async transaction<T>(operation: () => Promise<T>): Promise<T> {
    if (this.transactions.getStore()) {
      return operation();
    }

    const state: TransactionState = { operations: [] };
    const result = await this.transactions.run(state, operation);

    if (state.operations.length > 0) {
      await this.executeOperations(state.operations);
    }

    return result;
  }

  public async findIdempotentResult(
    organizationId: string,
    membershipId: string,
    requestId: string,
  ): Promise<StoredCommandResult | undefined> {
    const result = await this.query<{
      result: StoredCommandResult;
    }>("time_tracking_idempotency")
      .select("result")
      .eq("organization_id", organizationId)
      .eq("membership_id", membershipId)
      .eq("request_id", requestId)
      .maybeSingle();

    this.assertNoError(result, "Idempotency result could not be loaded.");
    return result.data?.result;
  }

  public async saveIdempotentResult(
    organizationId: string,
    membershipId: string,
    requestId: string,
    result: StoredCommandResult,
  ): Promise<void> {
    await this.enqueueOrExecute({ type: "save_idempotent_result", organizationId, membershipId, requestId, result });
  }

  public async findOpenSession(organizationId: string, membershipId: string): Promise<WorkSessionRecord | undefined> {
    const result = await this.query<WorkSessionRow>("work_sessions")
      .select(sessionColumns)
      .eq("organization_id", organizationId)
      .eq("membership_id", membershipId)
      .is("ended_at", null)
      .is("archived_at", null)
      .maybeSingle();

    this.assertNoError(result, "Open work session could not be loaded.");
    return result.data ? mapSession(result.data) : undefined;
  }

  public async findSession(organizationId: string, membershipId: string, sessionId: string): Promise<WorkSessionRecord | undefined> {
    const result = await this.query<WorkSessionRow>("work_sessions")
      .select(sessionColumns)
      .eq("organization_id", organizationId)
      .eq("membership_id", membershipId)
      .eq("id", sessionId)
      .is("archived_at", null)
      .maybeSingle();

    this.assertNoError(result, "Work session could not be loaded.");
    return result.data ? mapSession(result.data) : undefined;
  }

  public async listSessions(organizationId: string, membershipId: string, from: string, to: string): Promise<WorkSessionRecord[]> {
    const result = await this.query<WorkSessionRow>("work_sessions")
      .select(sessionColumns)
      .eq("organization_id", organizationId)
      .eq("membership_id", membershipId)
      .gte("work_date", from)
      .lte("work_date", to)
      .is("archived_at", null)
      .order("started_at", { ascending: true })
      .order("started_at", { ascending: true, foreignTable: "work_breaks" });

    this.assertNoError(result, "Work sessions could not be listed.");
    return (result.data ?? []).map(mapSession);
  }

  public async insertSession(session: WorkSessionRecord): Promise<void> {
    await this.enqueueOrExecute({ type: "insert_session", session });
  }

  public async updateSession(session: WorkSessionRecord): Promise<void> {
    await this.enqueueOrExecute({ type: "update_session", session });
  }

  public async appendClockEvent(event: ClockEventRecord): Promise<void> {
    await this.enqueueOrExecute({ type: "append_clock_event", event });
  }


  public async appendAuditEvent(event: AuditEventRecord): Promise<void> {
    await this.enqueueOrExecute({ type: "append_audit_event", event });
  }

  private query<T>(table: string): QueryBuilder<T> {
    return this.client.from<T>(table);
  }

  private async enqueueOrExecute(operation: WriteOperation): Promise<void> {
    const state = this.transactions.getStore();

    if (state) {
      state.operations.push(operation);
      return;
    }

    await this.executeOperations([operation]);
  }

  private async executeOperations(operations: WriteOperation[]): Promise<void> {
    const result = await this.client.rpc("time_tracking_apply_interval_operations", {
      operations: operations.map(serializeOperation),
    });

    if (result.error) {
      throw mapDatabaseError(result.error.message);
    }
  }

  private assertNoError<T>(result: SupabaseResult<T>, message: string): void {
    if (result.error) {
      throw new TimeTrackingError("INTERNAL_ERROR", message);
    }
  }
}

export class PostgresPeriodGuard {
  private readonly client: RpcClient;

  public constructor(client: SupabaseClient) {
    this.client = client as unknown as RpcClient;
  }

  public async assertPeriodOpen(input: {
    organizationId: string;
    membershipId: string;
    workDate: string;
    operation: "clock" | "manual" | "correction";
  }): Promise<void> {
    const result = await this.client.rpc("time_tracking_assert_period_open", {
      target_organization_id: input.organizationId,
      target_membership_id: input.membershipId,
      target_work_date: input.workDate,
      target_operation: input.operation,
    });

    if (result.error) {
      throw mapDatabaseError(result.error.message);
    }
  }
}

function mapSession(row: WorkSessionRow): WorkSessionRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    membershipId: row.membership_id,
    workDate: row.work_date,
    startedAt: row.started_at,
    ...(row.ended_at ? { endedAt: row.ended_at } : {}),
    source: row.source,
    version: row.version,
    ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
    breaks: (row.work_breaks ?? []).map(mapBreak).sort((left, right) => left.startedAt.localeCompare(right.startedAt)),
  };
}

function mapBreak(row: WorkBreakRow): WorkBreakRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    workSessionId: row.work_session_id,
    startedAt: row.started_at,
    ...(row.ended_at ? { endedAt: row.ended_at } : {}),
  };
}

function serializeOperation(operation: WriteOperation): Record<string, unknown> {
  return JSON.parse(JSON.stringify(operation)) as Record<string, unknown>;
}

function mapDatabaseError(message: string): TimeTrackingError {
  if (message.includes("period_closed")) {
    return new TimeTrackingError("PERIOD_CLOSED", "Der Zeitraum ist geschlossen.");
  }

  if (message.includes("duplicate key") || message.includes("unique constraint")) {
    return conflict("Die Operation wurde bereits verarbeitet oder verletzt eine eindeutige Einschränkung.");
  }

  if (message.includes("invalid_state")) {
    return new TimeTrackingError("INVALID_STATE", "Der Arbeitszeitstatus erlaubt diese Operation nicht.");
  }

  return new TimeTrackingError("INTERNAL_ERROR", "Die Arbeitszeitdaten konnten nicht gespeichert werden.");
}
