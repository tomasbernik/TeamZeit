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
import { SupabaseInvitationDelivery } from "./identity/supabase-invitation-delivery.js";
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
import { InMemoryReportingRepository } from "./reporting/memory-repository.js";
import { PostgresReportingRepository } from "./reporting/postgres-repository.js";
import { registerReportingRoutes, type ReportingRouteDependencies } from "./reporting/routes.js";
import { ReportingService } from "./reporting/service.js";
import { AbsenceService } from "./absence/service.js";
import { InMemoryAbsenceRepository } from "./absence/memory-repository.js";
import { PostgresAbsenceRepository } from "./absence/postgres-repository.js";
import { registerAbsenceRoutes, type AbsenceRouteDependencies } from "./absence/routes.js";

export interface ApiDependencies {
  identity?: IdentityContextDependencies;
  timeTracking?: TimeTrackingRouteDependencies;
  employeeAdministration?: EmployeeAdministrationRouteDependencies;
  monthClosing?: MonthClosingRouteDependencies;
  organisationStructure?: OrganisationStructureRouteDependencies;
  reporting?: ReportingRouteDependencies;
  absence?: AbsenceRouteDependencies;
  readinessCheck?: () => Promise<boolean>;
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
  app.addHook("onSend", async (request, reply) => {
    reply.header("X-Request-Id", request.id);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    if (config.nodeEnv === "production") reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "teamzeit-api",
    supabaseConfigured: config.supabaseConfigured,
  }));

  app.get("/ready", async (_request, reply) => {
    const ready = await (dependencies.readinessCheck ?? createReadinessCheck(config))();
    return reply.status(ready ? 200 : 503).send({
      status: ready ? "ready" : "unavailable",
      service: "teamzeit-api",
    });
  });

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
  registerReportingRoutes(app, config, dependencies.reporting ?? createDefaultReportingDependencies(config, dependencies.identity));
  registerAbsenceRoutes(app, config, dependencies.absence ?? createDefaultAbsenceDependencies(config, dependencies.identity));

  return app;
}

function createDefaultAbsenceDependencies(config: ApiConfig, identity?: IdentityContextDependencies): AbsenceRouteDependencies {
  const client = config.timeTrackingRepository === "postgres" ? createSupabaseServiceClient(config) : null;
  if (config.timeTrackingRepository === "postgres" && !client) throw new Error("TIME_TRACKING_REPOSITORY=postgres requires Supabase server credentials.");
  return { service: new AbsenceService(client ? new PostgresAbsenceRepository(client) : new InMemoryAbsenceRepository()), ...(identity ? { identity } : {}) };
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
      client ? new SupabaseInvitationDelivery(client, config.webOrigin) : undefined,
    ),
    ...(identity ? { identity } : {}),
  };
}

function normalizeDependencies(dependencies: ApiDependencies | IdentityContextDependencies): ApiDependencies {
  if ("identity" in dependencies || "timeTracking" in dependencies || "employeeAdministration" in dependencies || "monthClosing" in dependencies || "organisationStructure" in dependencies || "reporting" in dependencies || "absence" in dependencies || "readinessCheck" in dependencies) {
    return dependencies;
  }

  return { identity: dependencies as IdentityContextDependencies };
}

function createReadinessCheck(config: ApiConfig): () => Promise<boolean> {
  const client = createSupabaseServiceClient(config);
  return async () => {
    if (!client) return config.nodeEnv !== "production";
    try {
      const { error } = await client.from("organizations").select("id", { head: true, count: "exact" }).limit(1);
      return !error;
    } catch {
      return false;
    }
  };
}

function createDefaultReportingDependencies(config: ApiConfig, identity?: IdentityContextDependencies): ReportingRouteDependencies {
  const client = config.timeTrackingRepository === "postgres" ? createSupabaseServiceClient(config) : null;
  if (config.timeTrackingRepository === "postgres" && !client) throw new Error("TIME_TRACKING_REPOSITORY=postgres requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  return {
    service: new ReportingService(client ? new PostgresReportingRepository(client) : new InMemoryReportingRepository()),
    ...(identity ? { identity } : {}),
  };
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
