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
