import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

import type { ApiConfig } from "./config/env.js";
import { IdentityError, resolveCurrentContext, type IdentityContextDependencies } from "./identity/context.js";
import { createSupabaseServiceClient } from "./lib/supabase.js";
import { InMemoryTimeTrackingRepository } from "./time-tracking/memory-repository.js";
import { PostgresPeriodGuard, PostgresTimeTrackingRepository } from "./time-tracking/postgres-repository.js";
import { registerTimeTrackingRoutes, type TimeTrackingRouteDependencies } from "./time-tracking/routes.js";
import { TimeTrackingService } from "./time-tracking/service.js";
import type { PeriodGuard } from "./time-tracking/types.js";

export interface ApiDependencies {
  identity?: IdentityContextDependencies;
  timeTracking?: TimeTrackingRouteDependencies;
}

const openPeriodGuard: PeriodGuard = {
  async assertPeriodOpen() {
    return undefined;
  },
};

export function buildApp(
  config: ApiConfig,
  dependenciesOrIdentity: ApiDependencies | IdentityContextDependencies = {},
): FastifyInstance {
  const dependencies = normalizeDependencies(dependenciesOrIdentity);
  const app = Fastify({ logger: config.nodeEnv !== "test" });

  void app.register(cors, { origin: config.webOrigin, credentials: true });

  app.get("/health", async () => ({
    status: "ok",
    service: "teamzeit-api",
    supabaseConfigured: config.supabaseConfigured,
  }));

  app.get("/api/v1", async () => ({
    name: "TeamZeit API",
    version: "v1",
    status: "foundation",
  }));

  app.get("/api/v1/me", async (request, reply) => {
    try {
      return await resolveCurrentContext(config, request.headers.authorization, dependencies.identity);
    } catch (error) {
      if (error instanceof IdentityError) {
        return reply.status(error.statusCode).send({
          error: {
            code: error.code,
            message: error.message,
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
  });

  registerTimeTrackingRoutes(app, config, dependencies.timeTracking ?? createDefaultTimeTrackingDependencies(config, dependencies.identity));

  return app;
}

function normalizeDependencies(dependencies: ApiDependencies | IdentityContextDependencies): ApiDependencies {
  if ("identity" in dependencies || "timeTracking" in dependencies) {
    return dependencies;
  }

  return { identity: dependencies as IdentityContextDependencies };
}

function createDefaultTimeTrackingDependencies(
  config: ApiConfig,
  identity?: IdentityContextDependencies,
): TimeTrackingRouteDependencies {
  const productionDependencies = createProductionTimeTrackingDependencies(config, identity);
  if (productionDependencies) {
    return productionDependencies;
  }

  return {
    service: new TimeTrackingService({
      repository: new InMemoryTimeTrackingRepository(),
      periodGuard: openPeriodGuard,
      clock: { now: () => new Date() },
      ids: { uuid: () => randomUUID() },
    }),
    ...(identity ? { identity } : {}),
  };
}

function createProductionTimeTrackingDependencies(
  config: ApiConfig,
  identity?: IdentityContextDependencies,
): TimeTrackingRouteDependencies | undefined {
  if (config.timeTrackingRepository !== "postgres") {
    return undefined;
  }

  const client = createSupabaseServiceClient(config);
  if (!client) {
    throw new Error("TIME_TRACKING_REPOSITORY=postgres requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }

  return {
    service: new TimeTrackingService({
      repository: new PostgresTimeTrackingRepository(client),
      periodGuard: new PostgresPeriodGuard(client),
      clock: { now: () => new Date() },
      ids: { uuid: () => randomUUID() },
    }),
    ...(identity ? { identity } : {}),
  };
}
