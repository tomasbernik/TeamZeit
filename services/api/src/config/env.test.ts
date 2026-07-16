import { describe, expect, it } from "vitest";

import { readApiConfig } from "./env.js";

describe("readApiConfig", () => {
  it("provides local defaults without secrets", () => {
    const config = readApiConfig({ NODE_ENV: "test" });
    expect(config.port).toBe(3000);
    expect(config.supabaseConfigured).toBe(false);
    expect(config.supabaseServiceRoleConfigured).toBe(false);
    expect(config.timeTrackingRepository).toBe("memory");
  });

  it("recognises a complete Supabase configuration", () => {
    const config = readApiConfig({
      NODE_ENV: "test",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "publishable-key",
    });
    expect(config.supabaseConfigured).toBe(true);
    expect(config.supabaseServiceRoleConfigured).toBe(false);
  });

  it("keeps service-role configuration server-side and opt-in for time tracking", () => {
    const config = readApiConfig({
      NODE_ENV: "production",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "publishable-key",
      SUPABASE_SERVICE_ROLE_KEY: "server-only-key",
      TIME_TRACKING_REPOSITORY: "postgres",
    });

    expect(config.supabaseConfigured).toBe(true);
    expect(config.supabaseServiceRoleConfigured).toBe(true);
    expect(config.timeTrackingRepository).toBe("postgres");
  });
});
