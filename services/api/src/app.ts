import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";

import type { ApiConfig } from "./config/env.js";
import { IdentityError, resolveCurrentContext, type IdentityContextDependencies } from "./identity/context.js";

export function buildApp(config: ApiConfig, identityDependencies: IdentityContextDependencies = {}): FastifyInstance {
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
      return await resolveCurrentContext(config, request.headers.authorization, identityDependencies);
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

  return app;
}
