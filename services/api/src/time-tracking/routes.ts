import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { CreateCorrectionRequest, MembershipRole, UUID } from "@teamzeit/contracts";

import type { ApiConfig } from "../config/env.js";
import { IdentityError, resolveCurrentContext, type IdentityContextDependencies } from "../identity/context.js";
import { TimeTrackingError } from "./errors.js";
import { TimeTrackingService } from "./service.js";
import type { AttendanceMembershipContext, ReviewerContext } from "./types.js";

const uuidSchema = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const monthSchema = z.string().regex(/^\d{4}-\d{2}$/u);
const isoInstantSchema = z.string().datetime({ offset: true });

const createCorrectionSchema = z.object({
  sessionId: uuidSchema,
  expectedVersion: z.number().int().min(1),
  proposed: z.object({
    workDate: dateSchema,
    startedAt: isoInstantSchema,
    endedAt: isoInstantSchema,
    breakMinutes: z.number().int().min(0).max(1440),
  }),
  reason: z.string().min(3).max(1000),
}) satisfies z.ZodType<CreateCorrectionRequest>;

export interface TimeTrackingRouteDependencies {
  service: TimeTrackingService;
  identity?: IdentityContextDependencies;
}

interface AuthenticatedTenantContext {
  attendance: AttendanceMembershipContext;
  role: MembershipRole;
}

type Handler<T> = (context: AuthenticatedTenantContext) => Promise<T>;

export function registerTimeTrackingRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  dependencies: TimeTrackingRouteDependencies,
): void {
  app.get("/api/v1/attendance/today", async (request, reply) =>
    withAttendanceContext(request, reply, config, dependencies.identity, async ({ attendance }) =>
      dependencies.service.getCurrentDay(attendance),
    ),
  );

  app.get("/api/v1/attendance/days/:workDate", async (request, reply) =>
    withAttendanceContext(request, reply, config, dependencies.identity, async ({ attendance }) => {
      const { workDate } = parseParams(request, z.object({ workDate: dateSchema }));
      return dependencies.service.getDailyOverview(attendance, workDate);
    }),
  );

  app.get("/api/v1/attendance/months/:month", async (request, reply) =>
    withAttendanceContext(request, reply, config, dependencies.identity, async ({ attendance }) => {
      const { month } = parseParams(request, z.object({ month: monthSchema }));
      return dependencies.service.getMonthlyOverview(attendance, month);
    }),
  );

  app.get("/api/v1/attendance/sessions", async (request, reply) =>
    withAttendanceContext(request, reply, config, dependencies.identity, async ({ attendance }) => {
      const { from, to } = parseQuery(request, z.object({ from: dateSchema, to: dateSchema }));
      return dependencies.service.listOwnSessions(attendance, from, to);
    }),
  );

  app.post("/api/v1/attendance/commands/clock-in", async (request, reply) =>
    withWritableAttendanceContext(request, reply, config, dependencies.identity, async ({ attendance }) =>
      dependencies.service.clockIn(attendance, requireIdempotencyKey(request)),
    ),
  );

  app.post("/api/v1/attendance/commands/break-start", async (request, reply) =>
    withWritableAttendanceContext(request, reply, config, dependencies.identity, async ({ attendance }) =>
      dependencies.service.startBreak(attendance, requireIdempotencyKey(request)),
    ),
  );

  app.post("/api/v1/attendance/commands/break-end", async (request, reply) =>
    withWritableAttendanceContext(request, reply, config, dependencies.identity, async ({ attendance }) =>
      dependencies.service.endBreak(attendance, requireIdempotencyKey(request)),
    ),
  );

  app.post("/api/v1/attendance/commands/clock-out", async (request, reply) =>
    withWritableAttendanceContext(request, reply, config, dependencies.identity, async ({ attendance }) =>
      dependencies.service.clockOut(attendance, requireIdempotencyKey(request)),
    ),
  );

  app.post("/api/v1/corrections", async (request, reply) =>
    withWritableAttendanceContext(request, reply, config, dependencies.identity, async ({ attendance }) => {
      const correction = await dependencies.service.createCorrection(
        attendance,
        requireIdempotencyKey(request),
        parseBody(request, createCorrectionSchema),
      );
      return reply.status(201).send(correction);
    }),
  );

  app.post("/api/v1/corrections/:correctionId/review", async (request, reply) =>
    withAttendanceContext(request, reply, config, dependencies.identity, async ({ attendance, role }) => {
      const canReviewCorrections = role === "owner" || role === "admin";
      if (!canReviewCorrections) {
        throw new TimeTrackingError("FORBIDDEN", "Diese Mitgliedschaft darf Korrekturen nicht prüfen.");
      }

      const { correctionId } = parseParams(request, z.object({ correctionId: uuidSchema }));
      const command = parseBody(
        request,
        z.object({
          decision: z.enum(["approve", "reject"]),
          comment: z.string().max(1000).optional(),
        }),
      );
      const reviewer: ReviewerContext = {
        ...attendance,
        canReviewCorrections,
      };
      return dependencies.service.reviewCorrection(
        reviewer,
        correctionId,
        requireIdempotencyKey(request),
        command.comment === undefined ? { decision: command.decision } : { decision: command.decision, comment: command.comment },
      );
    }),
  );
}

async function withWritableAttendanceContext<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  config: ApiConfig,
  identity: IdentityContextDependencies | undefined,
  handler: Handler<T>,
): Promise<T | FastifyReply> {
  return withAttendanceContext(request, reply, config, identity, async (context) => {
    if (context.role === "auditor") {
      throw new TimeTrackingError("FORBIDDEN", "Diese Mitgliedschaft darf keine Arbeitszeit erfassen.");
    }

    return handler(context);
  });
}

async function withAttendanceContext<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  config: ApiConfig,
  identity: IdentityContextDependencies | undefined,
  handler: Handler<T>,
): Promise<T | FastifyReply> {
  try {
    const context = await resolveAttendanceContext(config, request, identity);
    return await handler(context);
  } catch (error) {
    return sendError(reply, request, error);
  }
}

async function resolveAttendanceContext(
  config: ApiConfig,
  request: FastifyRequest,
  identity: IdentityContextDependencies | undefined,
): Promise<AuthenticatedTenantContext> {
  const organizationId = singleHeader(request.headers["x-organization-id"]);
  if (!organizationId) {
    throw new TimeTrackingError("FORBIDDEN", "Organisation erforderlich.", "X-Organization-Id");
  }

  if (!uuidSchema.safeParse(organizationId).success) {
    throw new TimeTrackingError("VALIDATION_ERROR", "Organisation ist ungültig.", "X-Organization-Id");
  }

  const currentContext = await resolveCurrentContext(config, request.headers.authorization, identity);
  const membership = currentContext.memberships.find(
    (candidate) => candidate.organization.id === organizationId && candidate.status === "active",
  );

  if (!membership) {
    throw new TimeTrackingError("FORBIDDEN", "Keine aktive Mitgliedschaft für diese Organisation.");
  }

  return {
    role: membership.role,
    attendance: {
      organizationId: membership.organization.id,
      membershipId: membership.id,
      userId: currentContext.user.id,
      organizationTimeZone: membership.organization.timeZone,
    },
  };
}

function requireIdempotencyKey(request: FastifyRequest): UUID {
  const key = singleHeader(request.headers["idempotency-key"]);
  if (!key) {
    throw new TimeTrackingError("VALIDATION_ERROR", "Idempotency-Key erforderlich.", "Idempotency-Key");
  }

  if (!uuidSchema.safeParse(key).success) {
    throw new TimeTrackingError("VALIDATION_ERROR", "Idempotency-Key ist ungültig.", "Idempotency-Key");
  }

  return key;
}

function parseParams<T>(request: FastifyRequest, schema: z.ZodType<T>): T {
  const result = schema.safeParse(request.params);
  if (!result.success) {
    throw new TimeTrackingError("VALIDATION_ERROR", "Pfadparameter sind ungültig.");
  }

  return result.data;
}

function parseQuery<T>(request: FastifyRequest, schema: z.ZodType<T>): T {
  const result = schema.safeParse(request.query);
  if (!result.success) {
    throw new TimeTrackingError("VALIDATION_ERROR", "Abfrageparameter sind ungültig.");
  }

  return result.data;
}

function parseBody<T>(request: FastifyRequest, schema: z.ZodType<T>): T {
  const result = schema.safeParse(request.body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new TimeTrackingError("VALIDATION_ERROR", "Anfrageinhalt ist ungültig.", issue?.path.join("."));
  }

  return result.data;
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function sendError(reply: FastifyReply, request: FastifyRequest, error: unknown): FastifyReply {
  if (error instanceof IdentityError) {
    return reply.status(error.statusCode).send({
      error: { code: error.code, message: error.message, requestId: request.id },
    });
  }

  if (error instanceof TimeTrackingError) {
    return reply.status(statusForTimeTrackingError(error)).send({
      error: {
        code: error.code,
        message: error.message,
        ...(error.field ? { field: error.field } : {}),
        requestId: request.id,
      },
    });
  }

  request.log.error(error);
  return reply.status(500).send({
    error: { code: "INTERNAL_ERROR", message: "Interner Fehler.", requestId: request.id },
  });
}

function statusForTimeTrackingError(error: TimeTrackingError): number {
  if (error.code === "FORBIDDEN") return 403;
  if (error.code === "NOT_FOUND") return 404;
  if (error.code === "VALIDATION_ERROR") return 400;
  if (error.code === "PERIOD_CLOSED" || error.code === "INVALID_STATE" || error.code === "CONFLICT") return 409;
  return 500;
}
