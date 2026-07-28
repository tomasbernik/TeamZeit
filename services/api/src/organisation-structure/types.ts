import type {
  ArchiveStructureRequest,
  ManagerScopeDto,
  NamedStructureRequest,
  OrganisationStructureDto,
  SetManagerScopeRequest,
  SetTeamAssignmentRequest,
  TeamAssignmentDto,
  UUID,
} from "@teamzeit/contracts";
import type { MembershipRole } from "@teamzeit/contracts";

export interface StructureActor { organizationId: UUID; membershipId: UUID; userId: UUID; role: MembershipRole; }
export type StructureResult = OrganisationStructureDto | TeamAssignmentDto | ManagerScopeDto;
export interface StructureRepository {
  read(actor: StructureActor, on: string): Promise<OrganisationStructureDto>;
  command(actor: StructureActor, operation: string, requestId: UUID, payload: Record<string, unknown>): Promise<StructureResult>;
}
export type StructureCommand =
  | NamedStructureRequest
  | ArchiveStructureRequest
  | SetTeamAssignmentRequest
  | SetManagerScopeRequest;
