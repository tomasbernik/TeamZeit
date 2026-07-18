import { config as loadDotEnv } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

loadDotEnv({ path: ".env", quiet: true });

const supabaseUrl = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;

if (!publishableKey) {
  throw new Error("SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY is required for local E2E tests.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command: "pnpm dev:api",
      url: "http://127.0.0.1:3000/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        ...process.env,
        WEB_ORIGIN: "http://127.0.0.1:5173",
        SUPABASE_URL: supabaseUrl,
        SUPABASE_PUBLISHABLE_KEY: publishableKey,
        TIME_TRACKING_REPOSITORY: "postgres",
      },
    },
    {
      command: "pnpm dev:web",
      url: "http://127.0.0.1:5173/login",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        ...process.env,
        VITE_API_URL: "http://127.0.0.1:3000/api/v1",
        VITE_SUPABASE_URL: supabaseUrl,
        VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
      },
    },
  ],
});
