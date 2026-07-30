import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { ApiConfig } from "../config/env.js";
import {
  IdentityError,
  resolveCurrentContext,
  type IdentityContextDependencies,
} from "../identity/context.js";
import { TimeTrackingError } from "../time-tracking/errors.js";
import { AbsenceService } from "./service.js";

const uuid = z.string().uuid();
const date = z.string().date();
const create = z.object({
  type: z.enum(["vacation", "sickness", "other"]),
  startsOn: date,
  endsOn: date,
  employeeNote: z.string().max(1000).optional(),
});
const review = z.object({
  decision: z.enum(["approved", "rejected"]),
  reviewNote: z.string().max(1000).optional(),
  expectedVersion: z.number().int().positive(),
});

export interface AbsenceRouteDependencies {
  service: AbsenceService;
  identity?: IdentityContextDependencies;
}

export function registerAbsenceRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  dependencies: AbsenceRouteDependencies,
) {
  const actor = async (request: FastifyRequest) => {
    const context = await resolveCurrentContext(
      config,
      request.headers.authorization,
      dependencies.identity,
    );
    const organizationId = one(request.headers["x-organization-id"]);
    if (!organizationId || !uuid.safeParse(organizationId).success) {
      throw new TimeTrackingError("FORBIDDEN", "Organisation erforderlich.");
    }
    const membership = context.memberships.find(
      (item) => item.organization.id === organizationId,
    );
    if (!membership) {
      throw new TimeTrackingError("FORBIDDEN", "Keine aktive Mitgliedschaft.");
    }
    return {
      organizationId,
      membershipId: membership.id,
      userId: context.user.id,
      role: membership.role,
    };
  };

  app.get("/api/v1/absences", async (request, reply) =>
    run(reply, request, async () => dependencies.service.list(await actor(request))),
  );
  app.post("/api/v1/absences", async (request, reply) =>
    run(reply, request, async () =>
      dependencies.service.create(await actor(request), key(request), create.parse(request.body)),
    ),
  );
  app.post("/api/v1/absences/:id/cancel", async (request, reply) =>
    run(reply, request, async () => {
      const params = z.object({ id: uuid }).parse(request.params);
      const body = z
        .object({ expectedVersion: z.number().int().positive() })
        .parse(request.body);
      return dependencies.service.cancel(
        await actor(request),
        params.id,
        key(request),
        body.expectedVersion,
      );
    }),
  );
  app.post("/api/v1/absences/:id/review", async (request, reply) =>
    run(reply, request, async () => {
      const params = z.object({ id: uuid }).parse(request.params);
      return dependencies.service.review(
        await actor(request),
        params.id,
        key(request),
        review.parse(request.body),
      );
    }),
  );
}

async function run(
  reply: FastifyReply,
  request: FastifyRequest,
  operation: () => Promise<unknown>,
) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof IdentityError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, requestId: request.id },
      });
    }
    if (error instanceof TimeTrackingError) {
      const status =
        error.code === "FORBIDDEN"
          ? 403
          : error.code === "NOT_FOUND"
            ? 404
            : error.code === "VALIDATION_ERROR"
              ? 400
              : error.code === "CONFLICT"
                ? 409
                : 500;
      return reply.status(status).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.field ? { field: error.field } : {}),
          requestId: request.id,
        },
      });
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Ungültige Anfragedaten.",
          requestId: request.id,
        },
      });
    }
    request.log.error(error);
    return reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "Interner Fehler.",
        requestId: request.id,
      },
    });
  }
}

function key(request: FastifyRequest) {
  const value = one(request.headers["idempotency-key"]);
  if (!value || !uuid.safeParse(value).success) {
    throw new TimeTrackingError(
      "VALIDATION_ERROR",
      "Gültiger Idempotency-Key erforderlich.",
    );
  }
  return value;
}

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
