import { describe, expect, it } from "vitest";

import { readWebConfig } from "./env";

describe("readWebConfig", () => {
  it("uses safe local defaults without Supabase credentials", () => {
    const config = readWebConfig({} as ImportMetaEnv);
    expect(config.apiUrl).toBe("/api/v1");
    expect(config.supabaseConfigured).toBe(false);
  });

  it("marks Supabase configured only when both public values exist", () => {
    const config = readWebConfig({
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    } as ImportMetaEnv);
    expect(config.supabaseConfigured).toBe(true);
    expect(config.supabaseAnonKey).toBe("publishable-key");
  });

  it("keeps backwards compatibility with the legacy anon key name", () => {
    const config = readWebConfig({
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_ANON_KEY: "legacy-publishable-key",
    } as ImportMetaEnv);

    expect(config.supabaseConfigured).toBe(true);
    expect(config.supabaseAnonKey).toBe("legacy-publishable-key");
  });
});
