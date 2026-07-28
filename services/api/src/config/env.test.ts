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
      SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    });
    expect(config.supabaseConfigured).toBe(true);
    expect(config.supabaseAnonKey).toBe("publishable-key");
    expect(config.supabaseServiceRoleConfigured).toBe(false);
  });

  it("accepts the standard hosting-provider port while keeping API_PORT precedence", () => {
    expect(readApiConfig({ NODE_ENV: "test", PORT: "10000" }).port).toBe(10000);
    expect(readApiConfig({ NODE_ENV: "test", PORT: "10000", API_PORT: "3100" }).port).toBe(3100);
  });

  it("keeps service-role configuration server-side and opt-in for time tracking", () => {
    const config = readApiConfig({
      NODE_ENV: "production",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      SUPABASE_SECRET_KEY: "server-only-key",
      TIME_TRACKING_REPOSITORY: "postgres",
    });

    expect(config.supabaseConfigured).toBe(true);
    expect(config.supabaseServiceRoleConfigured).toBe(true);
    expect(config.supabaseServiceRoleKey).toBe("server-only-key");
    expect(config.timeTrackingRepository).toBe("postgres");
  });

  it("keeps backwards compatibility with legacy anon and service-role names", () => {
    const config = readApiConfig({
      NODE_ENV: "test",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "legacy-publishable-key",
      SUPABASE_SERVICE_ROLE_KEY: "legacy-server-only-key",
    });

    expect(config.supabaseAnonKey).toBe("legacy-publishable-key");
    expect(config.supabaseServiceRoleKey).toBe("legacy-server-only-key");
    expect(config.supabaseConfigured).toBe(true);
    expect(config.supabaseServiceRoleConfigured).toBe(true);
  });
});
