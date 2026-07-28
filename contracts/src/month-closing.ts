import type { ISODate, ISOInstant, UUID } from "./common";

export type MonthClosureStatus = "open" | "closed";

export interface MonthClosureDto {
  id?: UUID;
  organizationId: UUID;
  membershipId: UUID;
  monthStart: ISODate;
  status: MonthClosureStatus;
  closedAt?: ISOInstant;
  closedByMembershipId?: UUID;
  reopenedAt?: ISOInstant;
  reopenedByMembershipId?: UUID;
  reason?: string;
}

export interface ChangeMonthClosureRequest {
  membershipId: UUID;
  month: string;
  reason: string;
}
