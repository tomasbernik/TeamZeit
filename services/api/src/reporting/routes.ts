import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ApiConfig } from "../config/env.js";
import { IdentityError, resolveCurrentContext, type IdentityContextDependencies } from "../identity/context.js";
import { TimeTrackingError } from "../time-tracking/errors.js";
import { ReportingService } from "./service.js";

const uuid = z.string().uuid();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u);
export interface ReportingRouteDependencies { service: ReportingService; identity?: IdentityContextDependencies; }

export function registerReportingRoutes(app: FastifyInstance, config: ApiConfig, dependencies: ReportingRouteDependencies): void {
  app.get("/api/v1/reports/attendance/:month", async (request, reply) => {
    try {
      const organizationId = one(request.headers["x-organization-id"]);
      if (!organizationId || !uuid.safeParse(organizationId).success) throw new TimeTrackingError("FORBIDDEN", "Organisation erforderlich.");
      const parsed = z.object({ month }).safeParse(request.params);
      if (!parsed.success) throw new TimeTrackingError("VALIDATION_ERROR", "Der Berichtsmonat ist ungültig.", "month");
      const current = await resolveCurrentContext(config, request.headers.authorization, dependencies.identity);
      const membership = current.memberships.find((item) => item.organization.id === organizationId);
      if (!membership) throw new TimeTrackingError("FORBIDDEN", "Keine aktive Mitgliedschaft für diese Organisation.");
      return await dependencies.service.monthlyAttendance({
        organizationId, membershipId: membership.id, userId: current.user.id, role: membership.role,
      }, parsed.data.month);
    } catch (error) {
      return sendError(reply, request, error);
    }
  });
}

function sendError(reply: FastifyReply, request: FastifyRequest, error: unknown): FastifyReply {
  if (error instanceof IdentityError) return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id } });
  if (error instanceof TimeTrackingError) return reply.status(error.code === "FORBIDDEN" ? 403 : error.code === "VALIDATION_ERROR" ? 400 : 500).send({ error: { code: error.code, message: error.message, ...(error.field ? { field: error.field } : {}), requestId: request.id } });
  request.log.error(error); return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "Interner Fehler.", requestId: request.id } });
}
function one(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }
