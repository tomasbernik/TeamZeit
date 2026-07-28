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
import { EmployeeAdministrationService } from "./identity/administration.js";
import { InMemoryEmployeeAdministrationRepository } from "./identity/memory-administration-repository.js";
import { PostgresEmployeeAdministrationRepository } from "./identity/postgres-administration-repository.js";
import { registerEmployeeAdministrationRoutes, type EmployeeAdministrationRouteDependencies } from "./identity/routes.js";
import { InMemoryMonthClosingRepository } from "./month-closing/memory-repository.js";
import { PostgresMonthClosingRepository } from "./month-closing/postgres-repository.js";
import { registerMonthClosingRoutes, type MonthClosingRouteDependencies } from "./month-closing/routes.js";
import { MonthClosingService } from "./month-closing/service.js";
import { InMemoryOrganisationStructureRepository } from "./organisation-structure/memory-repository.js";
import { PostgresOrganisationStructureRepository } from "./organisation-structure/postgres-repository.js";
import { registerOrganisationStructureRoutes, type OrganisationStructureRouteDependencies } from "./organisation-structure/routes.js";
import { OrganisationStructureService } from "./organisation-structure/service.js";

export interface ApiDependencies {
  identity?: IdentityContextDependencies;
  timeTracking?: TimeTrackingRouteDependencies;
  employeeAdministration?: EmployeeAdministrationRouteDependencies;
  monthClosing?: MonthClosingRouteDependencies;
  organisationStructure?: OrganisationStructureRouteDependencies;
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
  registerEmployeeAdministrationRoutes(app, config, dependencies.employeeAdministration ?? createDefaultEmployeeAdministrationDependencies(config, dependencies.identity));
  registerMonthClosingRoutes(app, config, dependencies.monthClosing ?? createDefaultMonthClosingDependencies(config, dependencies.identity));
  registerOrganisationStructureRoutes(app, config, dependencies.organisationStructure ?? createDefaultOrganisationStructureDependencies(config, dependencies.identity));

  return app;
}

function createDefaultEmployeeAdministrationDependencies(
  config: ApiConfig,
  identity?: IdentityContextDependencies,
): EmployeeAdministrationRouteDependencies {
  const client = config.timeTrackingRepository === "postgres" ? createSupabaseServiceClient(config) : null;
  if (config.timeTrackingRepository === "postgres" && !client) {
    throw new Error("TIME_TRACKING_REPOSITORY=postgres requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  return {
    service: new EmployeeAdministrationService(
      client ? new PostgresEmployeeAdministrationRepository(client) : new InMemoryEmployeeAdministrationRepository(),
    ),
    ...(identity ? { identity } : {}),
  };
}

function normalizeDependencies(dependencies: ApiDependencies | IdentityContextDependencies): ApiDependencies {
  if ("identity" in dependencies || "timeTracking" in dependencies || "employeeAdministration" in dependencies || "monthClosing" in dependencies || "organisationStructure" in dependencies) {
    return dependencies;
  }

  return { identity: dependencies as IdentityContextDependencies };
}

function createDefaultOrganisationStructureDependencies(config: ApiConfig, identity?: IdentityContextDependencies): OrganisationStructureRouteDependencies {
  const client = config.timeTrackingRepository === "postgres" ? createSupabaseServiceClient(config) : null;
  if (config.timeTrackingRepository === "postgres" && !client) throw new Error("TIME_TRACKING_REPOSITORY=postgres requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  return { service: new OrganisationStructureService(client ? new PostgresOrganisationStructureRepository(client) : new InMemoryOrganisationStructureRepository()), ...(identity ? { identity } : {}) };
}

function createDefaultMonthClosingDependencies(config: ApiConfig, identity?: IdentityContextDependencies): MonthClosingRouteDependencies {
  const client = config.timeTrackingRepository === "postgres" ? createSupabaseServiceClient(config) : null;
  if (config.timeTrackingRepository === "postgres" && !client) throw new Error("TIME_TRACKING_REPOSITORY=postgres requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  return { service: new MonthClosingService(client ? new PostgresMonthClosingRepository(client) : new InMemoryMonthClosingRepository()), ...(identity ? { identity } : {}) };
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
