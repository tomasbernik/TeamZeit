import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config as loadDotEnv } from "dotenv";
import { beforeAll } from "vitest";

const repositoryEnvPath = fileURLToPath(new URL("../../../../.env", import.meta.url));
loadDotEnv({ path: repositoryEnvPath, quiet: true });

export const ids = {
  orgNorth: "20000000-0000-4000-8000-000000000001",
  orgSouth: "20000000-0000-4000-8000-000000000002",
  employeeOneUser: "10000000-0000-4000-8000-000000000001",
  employeeTwoUser: "10000000-0000-4000-8000-000000000002",
  ownerUser: "10000000-0000-4000-8000-000000000003",
  adminUser: "10000000-0000-4000-8000-000000000004",
  managerUser: "10000000-0000-4000-8000-000000000005",
  auditorUser: "10000000-0000-4000-8000-000000000006",
  employeeOneMembership: "30000000-0000-4000-8000-000000000001",
  employeeTwoMembership: "30000000-0000-4000-8000-000000000002",
  ownerMembership: "30000000-0000-4000-8000-000000000003",
  adminMembership: "30000000-0000-4000-8000-000000000004",
  managerMembership: "30000000-0000-4000-8000-000000000005",
  auditorMembership: "30000000-0000-4000-8000-000000000006",
  foreignMembership: "30000000-0000-4000-8000-000000000007",
  employeeOneSession: "70000000-0000-4000-8000-000000000001",
  employeeTwoSession: "70000000-0000-4000-8000-000000000002",
  foreignSession: "70000000-0000-4000-8000-000000000003",
  employeeOneClockEvent: "80000000-0000-4000-8000-000000000001",
  pendingCorrectionForAdmin: "a0000000-0000-4000-8000-000000000001",
  pendingCorrectionForOwner: "a0000000-0000-4000-8000-000000000002",
  seedAuditEvent: "b0000000-0000-4000-8000-000000000001",
} as const;

export interface LocalSupabaseEnvironment {
  url: string;
  publishableKey: string;
  secretKey: string;
  jwtSecret: string;
}

export function readLocalSupabaseEnvironment(): LocalSupabaseEnvironment {
  const url = readFirstEnvironmentValue("SUPABASE_URL", "API_URL");
  const publishableKey = readFirstEnvironmentValue(
    "SUPABASE_PUBLISHABLE_KEY",
    "PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY",
    "ANON_KEY",
  );
  const secretKey = readFirstEnvironmentValue(
    "SUPABASE_SECRET_KEY",
    "SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SERVICE_ROLE_KEY",
  );
  const jwtSecret = readFirstEnvironmentValue("SUPABASE_JWT_SECRET", "JWT_SECRET");
  const missing = [
    ...(url ? [] : ["SUPABASE_URL or API_URL"]),
    ...(publishableKey ? [] : ["SUPABASE_PUBLISHABLE_KEY/PUBLISHABLE_KEY or SUPABASE_ANON_KEY/ANON_KEY"]),
    ...(secretKey ? [] : ["SUPABASE_SECRET_KEY/SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY/SERVICE_ROLE_KEY"]),
    ...(jwtSecret ? [] : ["SUPABASE_JWT_SECRET or JWT_SECRET"]),
  ];

  if (missing.length > 0) {
    throw new Error(
      `Missing local Supabase integration environment: ${missing.join(", ")}. Run supabase status -o env and copy local-only values into .env.`,
    );
  }

  return {
    url,
    publishableKey,
    secretKey,
    jwtSecret,
  };
}

export function serviceClient(env: LocalSupabaseEnvironment): SupabaseClient {
  return createClient(env.url, env.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function userClient(env: LocalSupabaseEnvironment, userId: string): SupabaseClient {
  return createClient(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${signLocalJwt(env.jwtSecret, userId)}` } },
  });
}

export function signLocalJwt(secret: string, userId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    aud: "authenticated",
    exp: now + 3600,
    iat: now,
    role: "authenticated",
    sub: userId,
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", secret).update(unsigned).digest("base64url");

  return `${unsigned}.${signature}`;
}

export function requireLocalSupabase(): LocalSupabaseEnvironment {
  let env: LocalSupabaseEnvironment;

  beforeAll(() => {
    env = readLocalSupabaseEnvironment();
  });

  return new Proxy({} as LocalSupabaseEnvironment, {
    get(_target, property: keyof LocalSupabaseEnvironment) {
      return env[property];
    },
  });
}

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function readFirstEnvironmentValue(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }

  return "";
}
