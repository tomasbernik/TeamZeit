import type { IanaTimeZone, ISOInstant, UUID } from "./common";

export type MembershipRole = "owner" | "admin" | "manager" | "employee" | "auditor";
export type MembershipStatus = "invited" | "active" | "inactive";

export interface OrganizationSummary {
  id: UUID;
  name: string;
  slug: string;
  timeZone: IanaTimeZone;
  logoUrl?: string;
}

export interface UserProfile {
  id: UUID;
  displayName: string;
  email: string;
}

export interface MembershipSummary {
  id: UUID;
  organization: OrganizationSummary;
  role: MembershipRole;
  status: MembershipStatus;
  employeeNumber?: string;
}

export interface CurrentContextResponse {
  user: UserProfile;
  memberships: MembershipSummary[];
  issuedAt: ISOInstant;
}

export interface WorkPolicySummary {
  id: UUID;
  name: string;
  weeklyMinutes: number;
  minimumBreakMinutes: number;
}

export interface EmployeeAdministrationSummary {
  id: UUID;
  email: string;
  role: MembershipRole;
  status: MembershipStatus;
  teamId?: UUID | undefined;
  workPolicyId?: UUID | undefined;
  version: number;
  invitationSentAt?: ISOInstant | undefined;
}

export interface CreateEmployeeRequest {
  email: string;
  role: Exclude<MembershipRole, "owner">;
}

export interface InviteEmployeeRequest {
  email: string;
  role: Exclude<MembershipRole, "owner">;
  teamId?: UUID | undefined;
  workPolicyId?: UUID | undefined;
}

export interface UpdateEmployeeAssignmentRequest {
  role?: MembershipRole | undefined;
  teamId?: UUID | null | undefined;
  workPolicyId?: UUID | null | undefined;
  expectedVersion: number;
}
