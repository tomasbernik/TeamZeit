import type { ArchiveStructureRequest, NamedStructureRequest, SetManagerScopeRequest, SetTeamAssignmentRequest, UUID } from "@teamzeit/contracts";
import type { StructureActor, StructureRepository } from "./types.js";

export class OrganisationStructureError extends Error {
  constructor(public readonly code: "FORBIDDEN"|"NOT_FOUND"|"CONFLICT"|"VALIDATION_ERROR"|"INTERNAL_ERROR", message: string, public readonly field?: string) { super(message); }
}

export class OrganisationStructureService {
  constructor(private readonly repository: StructureRepository) {}
  read(actor: StructureActor, on: string) { return this.repository.read(actor, on); }
  createLocation(actor: StructureActor, requestId: UUID, input: NamedStructureRequest) { return this.mutate(actor, "create_location", requestId, input); }
  updateLocation(actor: StructureActor, id: UUID, requestId: UUID, input: NamedStructureRequest) { return this.mutate(actor, "update_location", requestId, { id, ...input }); }
  archiveLocation(actor: StructureActor, id: UUID, requestId: UUID, input: ArchiveStructureRequest) { return this.mutate(actor, "archive_location", requestId, { id, ...input }); }
  createTeam(actor: StructureActor, requestId: UUID, input: NamedStructureRequest) { return this.mutate(actor, "create_team", requestId, input); }
  updateTeam(actor: StructureActor, id: UUID, requestId: UUID, input: NamedStructureRequest) { return this.mutate(actor, "update_team", requestId, { id, ...input }); }
  archiveTeam(actor: StructureActor, id: UUID, requestId: UUID, input: ArchiveStructureRequest) { return this.mutate(actor, "archive_team", requestId, { id, ...input }); }
  assignTeam(actor: StructureActor, requestId: UUID, input: SetTeamAssignmentRequest) { return this.mutate(actor, "set_assignment", requestId, input); }
  setScope(actor: StructureActor, requestId: UUID, input: SetManagerScopeRequest) { return this.mutate(actor, "set_scope", requestId, input); }
  private mutate(actor: StructureActor, operation: string, requestId: UUID, input: object) {
    if (actor.role !== "admin" && actor.role !== "owner") throw new OrganisationStructureError("FORBIDDEN", "Nur Administratoren und Inhaber dürfen die Organisationsstruktur ändern.");
    return this.repository.command(actor, operation, requestId, input as Record<string, unknown>);
  }
}
