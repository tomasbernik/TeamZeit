import type { AbsenceListResponse, AbsenceRequestDto, MembershipRole, UUID } from "@teamzeit/contracts";
export interface AbsenceActor { organizationId: UUID; membershipId: UUID; userId: UUID; role: MembershipRole; }
export interface AbsenceRepository {
  list(actor: AbsenceActor): Promise<AbsenceListResponse>;
  command(actor: AbsenceActor, operation: "create" | "cancel" | "review", requestId: UUID, input: Record<string, unknown>): Promise<AbsenceRequestDto>;
}
