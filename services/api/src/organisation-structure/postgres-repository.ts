import type { OrganisationStructureDto, UUID } from "@teamzeit/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OrganisationStructureError } from "./service.js";
import type { StructureActor, StructureRepository, StructureResult } from "./types.js";

interface Result<T> { data: T | null; error: { message: string } | null; }
interface Client { rpc<T>(fn: string, args: Record<string, unknown>): Promise<Result<T>>; }

export class PostgresOrganisationStructureRepository implements StructureRepository {
  private readonly client: Client;
  constructor(client: SupabaseClient) { this.client = client as unknown as Client; }
  async read(actor: StructureActor, on: string): Promise<OrganisationStructureDto> {
    const result = await this.client.rpc<OrganisationStructureDto>("organisation_structure_read", {
      target_organization_id: actor.organizationId, actor_membership_id: actor.membershipId, target_date: on,
    });
    if (result.error || !result.data) throw mapError(result.error?.message);
    return result.data;
  }
  async command(actor: StructureActor, operation: string, requestId: UUID, payload: Record<string, unknown>): Promise<StructureResult> {
    const result = await this.client.rpc<StructureResult>("organisation_structure_apply", {
      target_organization_id: actor.organizationId, actor_membership_id: actor.membershipId,
      actor_user_id: actor.userId, command_operation: operation, command_request_id: requestId, command: payload,
    });
    if (result.error || !result.data) throw mapError(result.error?.message);
    return result.data;
  }
}
function mapError(message = "") {
  if (message.includes("structure_forbidden")) return new OrganisationStructureError("FORBIDDEN", "Keine Berechtigung für die Organisationsstruktur.");
  if (message.includes("structure_not_found")) return new OrganisationStructureError("NOT_FOUND", "Datensatz nicht gefunden.");
  if (message.includes("structure_conflict")) return new OrganisationStructureError("CONFLICT", "Die Änderung überschneidet sich mit einer bestehenden Zuordnung.");
  if (message.includes("structure_validation")) return new OrganisationStructureError("VALIDATION_ERROR", "Die Strukturdaten sind ungültig.");
  return new OrganisationStructureError("INTERNAL_ERROR", "Die Organisationsstruktur konnte nicht verarbeitet werden.");
}
