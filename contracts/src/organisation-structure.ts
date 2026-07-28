import type { ISODate, ISOInstant, UUID } from "./common";

export interface LocationDto {
  id: UUID;
  organizationId: UUID;
  name: string;
  archivedAt?: ISOInstant;
}

export interface TeamDto {
  id: UUID;
  organizationId: UUID;
  locationId?: UUID;
  name: string;
  archivedAt?: ISOInstant;
}

export interface TeamAssignmentDto {
  organizationId: UUID;
  teamId: UUID;
  membershipId: UUID;
  validFrom: ISODate;
  validUntil?: ISODate;
  primary: boolean;
}

export type ManagerScopeType = "location" | "team";

export interface ManagerScopeDto {
  id: UUID;
  organizationId: UUID;
  managerMembershipId: UUID;
  scopeType: ManagerScopeType;
  locationId?: UUID;
  teamId?: UUID;
  validFrom: ISODate;
  validUntil?: ISODate;
}

export interface OrganisationStructureDto {
  locations: LocationDto[];
  teams: TeamDto[];
  assignments: TeamAssignmentDto[];
  managerScopes: ManagerScopeDto[];
}

export interface NamedStructureRequest { name: string; locationId?: UUID | null | undefined; }
export interface ArchiveStructureRequest { archived: boolean; }
export interface SetTeamAssignmentRequest {
  membershipId: UUID;
  teamId: UUID;
  validFrom: ISODate;
  validUntil?: ISODate | null | undefined;
  primary?: boolean | undefined;
}
export interface SetManagerScopeRequest {
  managerMembershipId: UUID;
  scopeType: ManagerScopeType;
  locationId?: UUID | undefined;
  teamId?: UUID | undefined;
  validFrom: ISODate;
  validUntil?: ISODate | null | undefined;
}
