import { config as loadDotEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const repositoryEnvPath = fileURLToPath(new URL("../../../../.env", import.meta.url));
loadDotEnv({ path: repositoryEnvPath, quiet: true });

const apiEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  TIME_TRACKING_REPOSITORY: z.enum(["memory", "postgres"]).optional(),
});

export interface ApiConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  webOrigin: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceRoleKey?: string;
  supabaseConfigured: boolean;
  supabaseServiceRoleConfigured: boolean;
  timeTrackingRepository: "memory" | "postgres";
}

export function readApiConfig(source: NodeJS.ProcessEnv = process.env): ApiConfig {
  const value = apiEnvironmentSchema.parse(source);
  const supabaseConfigured = Boolean(value.SUPABASE_URL && value.SUPABASE_ANON_KEY);
  const supabaseServiceRoleConfigured = Boolean(value.SUPABASE_URL && value.SUPABASE_SERVICE_ROLE_KEY);
  const timeTrackingRepository = value.TIME_TRACKING_REPOSITORY ?? (value.NODE_ENV === "production" ? "postgres" : "memory");

  return {
    nodeEnv: value.NODE_ENV,
    host: value.API_HOST,
    port: value.API_PORT,
    webOrigin: value.WEB_ORIGIN,
    ...(value.SUPABASE_URL ? { supabaseUrl: value.SUPABASE_URL } : {}),
    ...(value.SUPABASE_ANON_KEY ? { supabaseAnonKey: value.SUPABASE_ANON_KEY } : {}),
    ...(value.SUPABASE_SERVICE_ROLE_KEY ? { supabaseServiceRoleKey: value.SUPABASE_SERVICE_ROLE_KEY } : {}),
    supabaseConfigured,
    supabaseServiceRoleConfigured,
    timeTrackingRepository,
  };
}
