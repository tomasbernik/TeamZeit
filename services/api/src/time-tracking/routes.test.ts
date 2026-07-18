import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { readApiConfig } from "../config/env.js";
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
describe("time tracking routes", () => {
  it("does not expose the correction workflow", async () => { const app = buildApp(readApiConfig({ NODE_ENV: "test" })); apps.push(app); const response = await app.inject({ method: "POST", url: "/api/v1/corrections" }); expect(response.statusCode).toBe(404); });
  it("requires authentication for attendance", async () => { const app = buildApp(readApiConfig({ NODE_ENV: "test" })); apps.push(app); const response = await app.inject({ method: "GET", url: "/api/v1/attendance/today", headers: { "x-organization-id": "00000000-0000-4000-8000-000000000001" } }); expect(response.statusCode).toBe(401); });
});
