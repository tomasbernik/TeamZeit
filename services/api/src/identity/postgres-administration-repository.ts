import type {
  CreateEmployeeRequest,
  EmployeeAdministrationSummary,
  UpdateEmployeeAssignmentRequest,
  UUID,
} from "@teamzeit/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EmployeeAdministrationError,
  type AdministrationActor,
  type EmployeeAdministrationRepository,
  type InviteCommand,
} from "./administration.js";

interface Result<T> {
  data: T | null;
  error: { message: string } | null;
}

interface Row {
  id: UUID;
  email: string;
  role: EmployeeAdministrationSummary["role"];
  status: EmployeeAdministrationSummary["status"];
  work_policy_id: UUID | null;
  version: number;
  invitation_sent_at: string | null;
}

interface Builder<T> extends PromiseLike<Result<T[]>> {
  select(columns: string): Builder<T>;
  eq(column: string, value: string): Builder<T>;
  order(column: string, options: { ascending: boolean }): Builder<T>;
}

interface Client {
  from<T>(table: string): Builder<T>;
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<Result<T>>;
}

const columns = "id, email, role, status, work_policy_id, version, invitation_sent_at";

export class PostgresEmployeeAdministrationRepository implements EmployeeAdministrationRepository {
  private readonly client: Client;

  public constructor(client: SupabaseClient) {
    this.client = client as unknown as Client;
  }

  public async list(organizationId: UUID): Promise<EmployeeAdministrationSummary[]> {
    const result = await this.client
      .from<Row>("memberships")
      .select(columns)
      .eq("organization_id", organizationId)
      .order("email", { ascending: true });
    if (result.error) throw internal();
    return (result.data ?? []).map(map);
  }

  public create(actor: AdministrationActor, command: CreateEmployeeRequest & { idempotencyKey: UUID }) {
    return this.apply(actor, "create", command.idempotencyKey, { email: command.email, role: command.role });
  }

  public sendInvitation(actor: AdministrationActor, membershipId: UUID, idempotencyKey: UUID) {
    return this.apply(actor, "send_invitation", idempotencyKey, { membershipId });
  }

  public invite(actor: AdministrationActor, command: InviteCommand) {
    return this.apply(actor, "create", command.idempotencyKey, {
      email: command.email,
      role: command.role,
      ...(command.teamId ? { teamId: command.teamId } : {}),
      ...(command.workPolicyId ? { workPolicyId: command.workPolicyId } : {}),
    });
  }

  public deactivate(actor: AdministrationActor, membershipId: UUID, expectedVersion: number, idempotencyKey: UUID) {
    return this.apply(actor, "deactivate", idempotencyKey, { membershipId, expectedVersion });
  }

  public updateAssignment(
    actor: AdministrationActor,
    membershipId: UUID,
    command: UpdateEmployeeAssignmentRequest,
    idempotencyKey: UUID,
  ) {
    return this.apply(actor, "update_assignment", idempotencyKey, { membershipId, ...command });
  }

  private async apply(
    actor: AdministrationActor,
    operation: "create" | "send_invitation" | "deactivate" | "update_assignment",
    idempotencyKey: UUID,
    command: Record<string, unknown>,
  ): Promise<EmployeeAdministrationSummary> {
    const result = await this.client.rpc<Row>("employee_administration_apply", {
      target_organization_id: actor.organizationId,
      actor_membership_id: actor.membershipId,
      actor_user_id: actor.userId,
      command_operation: operation,
      command_request_id: idempotencyKey,
      command,
    });
    if (result.error) throw mapError(result.error.message);
    if (!result.data) throw internal();
    return map(result.data);
  }
}

function map(row: Row): EmployeeAdministrationSummary {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    version: row.version,
    ...(row.work_policy_id ? { workPolicyId: row.work_policy_id } : {}),
    ...(row.invitation_sent_at ? { invitationSentAt: row.invitation_sent_at } : {}),
  };
}

function mapError(message: string): EmployeeAdministrationError {
  if (message.includes("employee_admin_forbidden")) return new EmployeeAdministrationError("FORBIDDEN", "Keine Berechtigung zur Mitarbeiterverwaltung.");
  if (message.includes("employee_admin_not_found")) return new EmployeeAdministrationError("NOT_FOUND", "Mitgliedschaft nicht gefunden.");
  if (message.includes("employee_admin_owner_required")) return new EmployeeAdministrationError("FORBIDDEN", "Nur Inhaber dürfen Administrator- oder Inhaberrollen vergeben.");
  if (message.includes("employee_admin_version_conflict")) return new EmployeeAdministrationError("CONFLICT", "Die Mitgliedschaft wurde zwischenzeitlich geändert.", "expectedVersion");
  if (message.includes("employee_admin_duplicate_email")) return new EmployeeAdministrationError("CONFLICT", "Für diese E-Mail besteht bereits eine Mitgliedschaft.", "email");
  if (message.includes("employee_admin_invalid_state")) return new EmployeeAdministrationError("CONFLICT", "Die Aktion ist im aktuellen Status nicht möglich.");
  if (message.includes("employee_admin_invalid_reference")) return new EmployeeAdministrationError("VALIDATION_ERROR", "Team oder Arbeitsregel gehört nicht zu dieser Organisation.");
  return internal();
}

function internal() {
  return new EmployeeAdministrationError("INTERNAL_ERROR", "Die Mitarbeiterverwaltung konnte nicht gespeichert werden.");
}
