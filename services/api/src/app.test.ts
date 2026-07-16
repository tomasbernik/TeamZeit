import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { readApiConfig } from "./config/env.js";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("TeamZeit API foundation", () => {
  it("reports health without requiring credentials", async () => {
    const app = buildApp(readApiConfig({ NODE_ENV: "test" }));
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "teamzeit-api",
      supabaseConfigured: false,
    });
  });

  it("exposes the versioned API root", async () => {
    const app = buildApp(readApiConfig({ NODE_ENV: "test" }));
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/v1" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ name: "TeamZeit API", version: "v1" });
  });
});
