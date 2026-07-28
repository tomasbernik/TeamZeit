import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ApiConfig } from "../config/env.js";
import { IdentityError, resolveCurrentContext, type IdentityContextDependencies } from "./context.js";
import { EmployeeAdministrationError, EmployeeAdministrationService } from "./administration.js";

const uuid = z.string().uuid();
const invite = z.object({ email: z.string().email(), role: z.enum(["admin", "manager", "employee", "auditor"]), teamId: uuid.optional(), workPolicyId: uuid.optional() });
const create = z.object({ email: z.string().email(), role: z.enum(["admin", "manager", "employee", "auditor"]) });
const assignment = z.object({ role: z.enum(["owner", "admin", "manager", "employee", "auditor"]).optional(), teamId: uuid.nullable().optional(), workPolicyId: uuid.nullable().optional(), expectedVersion: z.number().int().positive() });
export interface EmployeeAdministrationRouteDependencies { service: EmployeeAdministrationService; identity?: IdentityContextDependencies; }

export function registerEmployeeAdministrationRoutes(app: FastifyInstance, config: ApiConfig, dependencies: EmployeeAdministrationRouteDependencies) {
  app.get("/api/v1/employees", (request, reply) => handle(request, reply, config, dependencies, (actor) => dependencies.service.list(actor)));
  app.post("/api/v1/employees", (request, reply) => handle(request, reply, config, dependencies, async (actor) => reply.status(201).send(await dependencies.service.create(actor, { ...parse(create, request.body), idempotencyKey: key(request) }))));
  app.post("/api/v1/employees/:membershipId/invitation", (request, reply) => handle(request, reply, config, dependencies, (actor) => { const { membershipId } = parse(z.object({ membershipId: uuid }), request.params); return dependencies.service.sendInvitation(actor, membershipId, key(request)); }));
  app.post("/api/v1/employees/invitations", (request, reply) => handle(request, reply, config, dependencies, async (actor) => reply.status(201).send(await dependencies.service.invite(actor, { ...parse(invite, request.body), idempotencyKey: key(request) }))));
  app.post("/api/v1/employees/:membershipId/deactivate", (request, reply) => handle(request, reply, config, dependencies, (actor) => { const { membershipId } = parse(z.object({ membershipId: uuid }), request.params); const { expectedVersion } = parse(z.object({ expectedVersion: z.number().int().positive() }), request.body); return dependencies.service.deactivate(actor, membershipId, expectedVersion, key(request)); }));
  app.patch("/api/v1/employees/:membershipId/assignment", (request, reply) => handle(request, reply, config, dependencies, (actor) => { const { membershipId } = parse(z.object({ membershipId: uuid }), request.params); return dependencies.service.updateAssignment(actor, membershipId, parse(assignment, request.body), key(request)); }));
}
async function handle<T>(request: FastifyRequest, reply: FastifyReply, config: ApiConfig, dependencies: EmployeeAdministrationRouteDependencies, action: (actor: { organizationId: string; membershipId: string; userId: string; role: "owner"|"admin"|"manager"|"employee"|"auditor" }) => Promise<T>) {
  try { const organizationId = one(request.headers["x-organization-id"]); if (!organizationId || !uuid.safeParse(organizationId).success) throw new EmployeeAdministrationError("FORBIDDEN", "Organisation erforderlich."); const current = await resolveCurrentContext(config, request.headers.authorization, dependencies.identity); const membership = current.memberships.find((item) => item.organization.id === organizationId && item.status === "active"); if (!membership) throw new EmployeeAdministrationError("FORBIDDEN", "Keine aktive Mitgliedschaft für diese Organisation."); return await action({ organizationId, membershipId: membership.id, userId: current.user.id, role: membership.role }); }
  catch (error) { if (error instanceof IdentityError) return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id } }); if (error instanceof EmployeeAdministrationError) return reply.status(error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : error.code === "VALIDATION_ERROR" ? 400 : error.code === "INTERNAL_ERROR" ? 500 : 409).send({ error: { code: error.code, message: error.message, ...(error.field ? { field: error.field } : {}), requestId: request.id } }); request.log.error(error); return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "Interner Fehler.", requestId: request.id } }); }
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); if (!result.success) throw new EmployeeAdministrationError("VALIDATION_ERROR", "Anfrageinhalt ist ungültig.", result.error.issues[0]?.path.join(".")); return result.data; }
function key(request: FastifyRequest) { const value = one(request.headers["idempotency-key"]); if (!value || !uuid.safeParse(value).success) throw new EmployeeAdministrationError("VALIDATION_ERROR", "Gültiger Idempotency-Key erforderlich.", "Idempotency-Key"); return value; }
function one(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }
