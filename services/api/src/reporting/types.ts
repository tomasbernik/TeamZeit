import type { MembershipRole, MonthlyAttendanceReport, UUID } from "@teamzeit/contracts";

export interface ReportingActor {
  organizationId: UUID;
  membershipId: UUID;
  userId: UUID;
  role: MembershipRole;
}

export interface ReportingRepository {
  monthlyAttendance(actor: ReportingActor, month: string): Promise<MonthlyAttendanceReport>;
}
