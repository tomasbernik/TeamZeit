import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { CreateWorkSessionRequest, MembershipRole, UpdateWorkSessionRequest, UUID } from "@teamzeit/contracts";
import type { ApiConfig } from "../config/env.js";
import { IdentityError, resolveCurrentContext, type IdentityContextDependencies } from "../identity/context.js";
import { TimeTrackingError } from "./errors.js";
import { TimeTrackingService } from "./service.js";
import type { AttendanceMembershipContext } from "./types.js";

const uuidSchema = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const monthSchema = z.string().regex(/^\d{4}-\d{2}$/u);
const instantSchema = z.string().datetime({ offset: true });
const createSchema = z.object({ workDate: dateSchema, startedAt: instantSchema, endedAt: instantSchema }) satisfies z.ZodType<CreateWorkSessionRequest>;
const updateSchema = createSchema.extend({ expectedVersion: z.number().int().min(1) }) satisfies z.ZodType<UpdateWorkSessionRequest>;
export interface TimeTrackingRouteDependencies { service: TimeTrackingService; identity?: IdentityContextDependencies; }
interface TenantContext { attendance: AttendanceMembershipContext; role: MembershipRole; }
type Handler<T> = (context: TenantContext) => Promise<T>;

export function registerTimeTrackingRoutes(app: FastifyInstance, config: ApiConfig, dependencies: TimeTrackingRouteDependencies): void {
  app.get("/api/v1/attendance/today", (request, reply) => withContext(request, reply, config, dependencies.identity, ({ attendance }) => dependencies.service.getCurrentDay(attendance)));
  app.get("/api/v1/attendance/days/:workDate", (request, reply) => withContext(request, reply, config, dependencies.identity, ({ attendance }) => {
    const { workDate } = parseParams(request, z.object({ workDate: dateSchema })); return dependencies.service.getDailyOverview(attendance, workDate);
  }));
  app.get("/api/v1/attendance/months/:month", (request, reply) => withContext(request, reply, config, dependencies.identity, ({ attendance }) => {
    const { month } = parseParams(request, z.object({ month: monthSchema })); return dependencies.service.getMonthlyOverview(attendance, month);
  }));
  app.get("/api/v1/attendance/sessions", (request, reply) => withContext(request, reply, config, dependencies.identity, ({ attendance }) => {
    const { from, to } = parseQuery(request, z.object({ from: dateSchema, to: dateSchema })); return dependencies.service.listOwnSessions(attendance, from, to);
  }));
  for (const [path, method] of [["clock-in", "clockIn"], ["break-start", "startBreak"], ["break-end", "endBreak"], ["clock-out", "clockOut"]] as const) {
    app.post(`/api/v1/attendance/commands/${path}`, (request, reply) => withWritableContext(request, reply, config, dependencies.identity, ({ attendance }) => dependencies.service[method](attendance, requireKey(request))));
  }
  app.post("/api/v1/attendance/sessions", (request, reply) => withWritableContext(request, reply, config, dependencies.identity, async ({ attendance }) => reply.status(201).send(await dependencies.service.createSession(attendance, requireKey(request), parseBody(request, createSchema)))));
  app.put("/api/v1/attendance/sessions/:sessionId", (request, reply) => withWritableContext(request, reply, config, dependencies.identity, ({ attendance }) => {
    const { sessionId } = parseParams(request, z.object({ sessionId: uuidSchema })); return dependencies.service.updateSession(attendance, sessionId, requireKey(request), parseBody(request, updateSchema));
  }));
  app.delete("/api/v1/attendance/sessions/:sessionId", (request, reply) => withWritableContext(request, reply, config, dependencies.identity, ({ attendance }) => {
    const { sessionId } = parseParams(request, z.object({ sessionId: uuidSchema }));
    const { expectedVersion } = parseQuery(request, z.object({ expectedVersion: z.coerce.number().int().min(1) }));
    return dependencies.service.archiveSession(attendance, sessionId, requireKey(request), expectedVersion);
  }));
}

function withWritableContext<T>(request: FastifyRequest, reply: FastifyReply, config: ApiConfig, identity: IdentityContextDependencies | undefined, handler: Handler<T>) {
  return withContext(request, reply, config, identity, async (context) => { if (context.role === "auditor") throw new TimeTrackingError("FORBIDDEN", "Diese Mitgliedschaft darf keine Arbeitszeit erfassen."); return handler(context); });
}
async function withContext<T>(request: FastifyRequest, reply: FastifyReply, config: ApiConfig, identity: IdentityContextDependencies | undefined, handler: Handler<T>): Promise<T | FastifyReply> {
  try { return await handler(await resolveContext(config, request, identity)); } catch (error) { return sendError(reply, request, error); }
}
async function resolveContext(config: ApiConfig, request: FastifyRequest, identity: IdentityContextDependencies | undefined): Promise<TenantContext> {
  const organizationId = single(request.headers["x-organization-id"]);
  if (!organizationId || !uuidSchema.safeParse(organizationId).success) throw new TimeTrackingError("FORBIDDEN", "Organisation erforderlich.", "X-Organization-Id");
  const current = await resolveCurrentContext(config, request.headers.authorization, identity);
  const membership = current.memberships.find((item) => item.organization.id === organizationId && item.status === "active");
  if (!membership) throw new TimeTrackingError("FORBIDDEN", "Keine aktive Mitgliedschaft für diese Organisation.");
  return { role: membership.role, attendance: { organizationId: membership.organization.id, membershipId: membership.id, userId: current.user.id, organizationTimeZone: membership.organization.timeZone } };
}
function requireKey(request: FastifyRequest): UUID { const key = single(request.headers["idempotency-key"]); if (!key || !uuidSchema.safeParse(key).success) throw new TimeTrackingError("VALIDATION_ERROR", "Gültiger Idempotency-Key erforderlich.", "Idempotency-Key"); return key; }
function parseParams<T>(request: FastifyRequest, schema: z.ZodType<T>): T { return parse(request.params, schema, "Pfadparameter sind ungültig."); }
function parseQuery<T>(request: FastifyRequest, schema: z.ZodType<T>): T { return parse(request.query, schema, "Abfrageparameter sind ungültig."); }
function parseBody<T>(request: FastifyRequest, schema: z.ZodType<T>): T { return parse(request.body, schema, "Anfrageinhalt ist ungültig."); }
function parse<T>(value: unknown, schema: z.ZodType<T>, message: string): T { const result = schema.safeParse(value); if (!result.success) throw new TimeTrackingError("VALIDATION_ERROR", message, result.error.issues[0]?.path.join(".")); return result.data; }
function single(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }
function sendError(reply: FastifyReply, request: FastifyRequest, error: unknown): FastifyReply {
  if (error instanceof IdentityError) return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id } });
  if (error instanceof TimeTrackingError) return reply.status(error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : error.code === "VALIDATION_ERROR" ? 400 : error.code === "INTERNAL_ERROR" ? 500 : 409).send({ error: { code: error.code, message: error.message, ...(error.field ? { field: error.field } : {}), requestId: request.id } });
  request.log.error(error); return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "Interner Fehler.", requestId: request.id } });
}
