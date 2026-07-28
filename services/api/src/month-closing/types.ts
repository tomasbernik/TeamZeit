import type { MonthClosureDto, UUID } from "@teamzeit/contracts";
export interface MonthClosingActor { organizationId: UUID; membershipId: UUID; userId: UUID; }
export interface MonthClosingCommand extends MonthClosingActor { targetMembershipId: UUID; monthStart: string; reason: string; requestId: UUID; occurredAt: string; }
export interface MonthClosingRepository { get(organizationId: UUID, membershipId: UUID, monthStart: string): Promise<MonthClosureDto | undefined>; close(command: MonthClosingCommand): Promise<MonthClosureDto>; reopen(command: MonthClosingCommand): Promise<MonthClosureDto>; }
