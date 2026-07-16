import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";

import type { ApiConfig } from "./config/env.js";

export function buildApp(config: ApiConfig): FastifyInstance {
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

  return app;
}
