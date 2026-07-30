import type { ISODate, ISOInstant, UUID } from "./common";

export type AbsenceType = "vacation" | "sickness" | "other";
export type AbsenceStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface AbsenceRequestDto {
  id: UUID;
  organizationId: UUID;
  membershipId: UUID;
  type: AbsenceType;
  startsOn: ISODate;
  endsOn: ISODate;
  status: AbsenceStatus;
  employeeNote?: string | undefined;
  reviewNote?: string | undefined;
  reviewedByMembershipId?: UUID;
  reviewedAt?: ISOInstant;
  createdAt: ISOInstant;
  version: number;
}

export interface CreateAbsenceRequest {
  type: AbsenceType;
  startsOn: ISODate;
  endsOn: ISODate;
  employeeNote?: string | undefined;
}

export interface ReviewAbsenceRequest {
  decision: "approved" | "rejected";
  reviewNote?: string | undefined;
  expectedVersion: number;
}

export interface AbsenceListResponse {
  items: AbsenceRequestDto[];
}
