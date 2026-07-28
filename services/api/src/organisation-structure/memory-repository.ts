import { randomUUID } from "node:crypto";
import type { LocationDto, ManagerScopeDto, OrganisationStructureDto, TeamAssignmentDto, TeamDto, UUID } from "@teamzeit/contracts";
import { OrganisationStructureError } from "./service.js";
import type { StructureActor, StructureRepository, StructureResult } from "./types.js";

export class InMemoryOrganisationStructureRepository implements StructureRepository {
  private state: OrganisationStructureDto = { locations: [], teams: [], assignments: [], managerScopes: [] };
  private results = new Map<UUID, StructureResult>();
  async read(actor: StructureActor, on: string) {
    if (actor.role === "employee") return { locations: [], teams: [], assignments: [], managerScopes: [] };
    if (actor.role !== "manager") return structuredClone(this.state);
    const scopes = this.state.managerScopes.filter(s => s.managerMembershipId === actor.membershipId && s.validFrom <= on && (!s.validUntil || s.validUntil >= on));
    const teamIds = new Set(scopes.flatMap(s => s.teamId ? [s.teamId] : this.state.teams.filter(t => t.locationId === s.locationId).map(t => t.id)));
    const teams = this.state.teams.filter(t => teamIds.has(t.id));
    return { locations: this.state.locations.filter(l => teams.some(t => t.locationId === l.id)), teams, assignments: this.state.assignments.filter(a => teamIds.has(a.teamId) && a.validFrom <= on && (!a.validUntil || a.validUntil >= on)), managerScopes: scopes };
  }
  async command(actor: StructureActor, operation: string, requestId: UUID, p: Record<string, unknown>) {
    const prior = this.results.get(requestId); if (prior) return prior;
    const id = String(p.id ?? randomUUID()); let result: StructureResult;
    if (operation === "create_location") { const row: LocationDto = { id, organizationId: actor.organizationId, name: String(p.name).trim() }; this.state.locations.push(row); result = row as unknown as OrganisationStructureDto; }
    else if (operation === "update_location" || operation === "archive_location") { const row = this.state.locations.find(x => x.id === id); if (!row) throw new OrganisationStructureError("NOT_FOUND", "Standort nicht gefunden."); if (operation === "update_location") row.name = String(p.name).trim(); else if (p.archived) row.archivedAt = new Date().toISOString(); else delete row.archivedAt; result = row as unknown as OrganisationStructureDto; }
    else if (operation === "create_team") { const row: TeamDto = { id, organizationId: actor.organizationId, name: String(p.name).trim(), ...(p.locationId ? { locationId: String(p.locationId) } : {}) }; this.state.teams.push(row); result = row as unknown as OrganisationStructureDto; }
    else if (operation === "update_team" || operation === "archive_team") { const row = this.state.teams.find(x => x.id === id); if (!row) throw new OrganisationStructureError("NOT_FOUND", "Team nicht gefunden."); if (operation === "update_team") { row.name = String(p.name).trim(); if (p.locationId) row.locationId = String(p.locationId); } else if (p.archived) row.archivedAt = new Date().toISOString(); else delete row.archivedAt; result = row as unknown as OrganisationStructureDto; }
    else if (operation === "set_assignment") { const row: TeamAssignmentDto = { organizationId: actor.organizationId, teamId: String(p.teamId), membershipId: String(p.membershipId), validFrom: String(p.validFrom), ...(p.validUntil ? { validUntil: String(p.validUntil) } : {}), primary: p.primary !== false }; this.state.assignments.push(row); result = row; }
    else { const row: ManagerScopeDto = { id, organizationId: actor.organizationId, managerMembershipId: String(p.managerMembershipId), scopeType: p.scopeType as "team"|"location", validFrom: String(p.validFrom), ...(p.validUntil ? { validUntil: String(p.validUntil) } : {}), ...(p.teamId ? { teamId: String(p.teamId) } : {}), ...(p.locationId ? { locationId: String(p.locationId) } : {}) }; this.state.managerScopes.push(row); result = row; }
    this.results.set(requestId, structuredClone(result)); return result;
  }
}
