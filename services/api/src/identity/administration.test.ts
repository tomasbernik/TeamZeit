import { describe, expect, it } from "vitest";
import { EmployeeAdministrationError, EmployeeAdministrationService, type AdministrationActor, type EmployeeAdministrationRepository } from "./administration.js";

const owner: AdministrationActor = { organizationId: "20000000-0000-4000-8000-000000000001", membershipId: "30000000-0000-4000-8000-000000000001", userId: "10000000-0000-4000-8000-000000000001", role: "owner" };
const repository: EmployeeAdministrationRepository = { async list() { return []; }, async create(_actor, command) { return { id: "30000000-0000-4000-8000-000000000002", email: command.email, role: command.role, status: "invited", version: 1 }; }, async sendInvitation() { throw new Error("unused"); }, async invite(_actor, command) { return { id: "30000000-0000-4000-8000-000000000002", email: command.email, role: command.role, status: "invited", version: 1 }; }, async deactivate() { throw new Error("unused"); }, async updateAssignment() { throw new Error("unused"); } };

describe("employee administration", () => {
  it("normalizes an invitation and uses the actor organization", async () => { const service = new EmployeeAdministrationService(repository); await expect(service.invite(owner, { email: " ADA@Example.Test ", role: "employee", idempotencyKey: "90000000-0000-4000-8000-000000000001" })).resolves.toMatchObject({ email: "ada@example.test" }); });
  it("denies administrators assigning privileged roles", async () => { const service = new EmployeeAdministrationService(repository); const admin = { ...owner, role: "admin" as const }; await expect(service.updateAssignment(admin, "30000000-0000-4000-8000-000000000002", { role: "owner", expectedVersion: 1 }, "90000000-0000-4000-8000-000000000001")).rejects.toMatchObject({ code: "FORBIDDEN" }); });
  it("denies managers even when they supply another organization id", async () => { const service = new EmployeeAdministrationService(repository); await expect(service.list({ ...owner, organizationId: "20000000-0000-4000-8000-000000000002", role: "manager" })).rejects.toBeInstanceOf(EmployeeAdministrationError); });
  it("prevents self-deactivation", async () => { const service = new EmployeeAdministrationService(repository); await expect(service.deactivate(owner, owner.membershipId, 1, "90000000-0000-4000-8000-000000000001")).rejects.toMatchObject({ code: "CONFLICT" }); });
});
