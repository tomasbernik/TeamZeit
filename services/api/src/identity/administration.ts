import type { CreateEmployeeRequest, EmployeeAdministrationSummary, InviteEmployeeRequest, MembershipRole, UpdateEmployeeAssignmentRequest, UUID } from "@teamzeit/contracts";

export interface AdministrationActor { organizationId: UUID; membershipId: UUID; userId: UUID; role: MembershipRole; }
export interface InviteCommand extends InviteEmployeeRequest { idempotencyKey: UUID; }
export interface EmployeeAdministrationRepository {
  list(organizationId: UUID): Promise<EmployeeAdministrationSummary[]>;
  create(actor: AdministrationActor, command: CreateEmployeeRequest & { idempotencyKey: UUID }): Promise<EmployeeAdministrationSummary>;
  sendInvitation(actor: AdministrationActor, membershipId: UUID, idempotencyKey: UUID): Promise<EmployeeAdministrationSummary>;
  invite(actor: AdministrationActor, command: InviteCommand): Promise<EmployeeAdministrationSummary>;
  deactivate(actor: AdministrationActor, membershipId: UUID, expectedVersion: number, idempotencyKey: UUID): Promise<EmployeeAdministrationSummary>;
  updateAssignment(actor: AdministrationActor, membershipId: UUID, command: UpdateEmployeeAssignmentRequest, idempotencyKey: UUID): Promise<EmployeeAdministrationSummary>;
}

export class EmployeeAdministrationError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR" | "INTERNAL_ERROR", message: string, public readonly field?: string) { super(message); }
}

export class EmployeeAdministrationService {
  constructor(private readonly repository: EmployeeAdministrationRepository) {}
  async list(actor: AdministrationActor) { this.assertAdmin(actor); return this.repository.list(actor.organizationId); }
  async create(actor: AdministrationActor, command: CreateEmployeeRequest & { idempotencyKey: UUID }) { this.assertAdmin(actor); this.assertRoleChange(actor, command.role); return this.repository.create(actor, { ...command, email: command.email.trim().toLowerCase() }); }
  async sendInvitation(actor: AdministrationActor, membershipId: UUID, idempotencyKey: UUID) { this.assertAdmin(actor); return this.repository.sendInvitation(actor, membershipId, idempotencyKey); }
  async invite(actor: AdministrationActor, command: InviteCommand) {
    this.assertAdmin(actor); this.assertRoleChange(actor, command.role);
    return this.repository.invite(actor, { ...command, email: command.email.trim().toLowerCase() });
  }
  async deactivate(actor: AdministrationActor, membershipId: UUID, expectedVersion: number, idempotencyKey: UUID) {
    this.assertAdmin(actor); if (membershipId === actor.membershipId) throw new EmployeeAdministrationError("CONFLICT", "Die eigene Mitgliedschaft kann nicht deaktiviert werden.");
    return this.repository.deactivate(actor, membershipId, expectedVersion, idempotencyKey);
  }
  async updateAssignment(actor: AdministrationActor, membershipId: UUID, command: UpdateEmployeeAssignmentRequest, idempotencyKey: UUID) {
    this.assertAdmin(actor); if (command.role) this.assertRoleChange(actor, command.role);
    return this.repository.updateAssignment(actor, membershipId, command, idempotencyKey);
  }
  private assertAdmin(actor: AdministrationActor) { if (actor.role !== "admin" && actor.role !== "owner") throw new EmployeeAdministrationError("FORBIDDEN", "Nur Administratoren dürfen Mitarbeitende verwalten."); }
  private assertRoleChange(actor: AdministrationActor, role: MembershipRole) { if ((role === "owner" || role === "admin") && actor.role !== "owner") throw new EmployeeAdministrationError("FORBIDDEN", "Nur Inhaber dürfen Administrator- oder Inhaberrollen vergeben."); }
}
