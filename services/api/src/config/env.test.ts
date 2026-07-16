import { describe, expect, it } from "vitest";

import { readApiConfig } from "./env.js";

describe("readApiConfig", () => {
  it("provides local defaults without secrets", () => {
    const config = readApiConfig({ NODE_ENV: "test" });
    expect(config.port).toBe(3000);
    expect(config.supabaseConfigured).toBe(false);
  });

  it("recognises a complete Supabase configuration", () => {
    const config = readApiConfig({
      NODE_ENV: "test",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "publishable-key",
    });
    expect(config.supabaseConfigured).toBe(true);
  });
});
