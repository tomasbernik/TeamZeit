import type { CurrentContextResponse, MembershipRole, MembershipStatus } from "@teamzeit/contracts";

import type { ApiConfig } from "../config/env.js";
import { createSupabaseClient } from "../lib/supabase.js";

interface SupabaseQueryResult<T> {
  data: T | null;
  error: { message: string } | null;
}

interface SupabaseAuthUser {
  id: string;
  email?: string;
  user_metadata?: { full_name?: string; name?: string };
}

interface SupabaseAuthClient {
  getUser(jwt?: string): Promise<SupabaseQueryResult<{ user: SupabaseAuthUser | null }>>;
}

interface SupabaseClientLike {
  auth: SupabaseAuthClient;
  from(table: string): unknown;
}

type SupabaseClientFactory = (config: ApiConfig, accessToken?: string) => SupabaseClientLike | null;

interface ProfileRow {
  display_name: string | null;
}

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  time_zone: string;
  logo_path: string | null;
}

interface MembershipRow {
  id: string;
  role: MembershipRole;
  status: MembershipStatus;
  employee_number: string | null;
  organization: OrganizationRow | OrganizationRow[] | null;
}

interface QueryBuilder<T> {
  select(columns: string): QueryBuilder<T>;
  eq(column: string, value: string): QueryBuilder<T>;
  order(column: string, options?: { ascending?: boolean }): QueryBuilder<T>;
  maybeSingle(): Promise<SupabaseQueryResult<T>>;
  then<TResult1 = SupabaseQueryResult<T[]>, TResult2 = never>(
    onfulfilled?: ((value: SupabaseQueryResult<T[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

export interface IdentityContextDependencies {
  createClient?: SupabaseClientFactory;
  now?: () => Date;
}

export class IdentityError extends Error {
  constructor(
    public readonly statusCode: 401 | 403 | 500,
    public readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "INTERNAL_ERROR",
    message: string,
  ) {
    super(message);
  }
}

function bearerToken(authorization: string | undefined): string {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    throw new IdentityError(401, "UNAUTHENTICATED", "Anmeldung erforderlich.");
  }

  return match[1];
}

function query<T>(client: SupabaseClientLike, table: string): QueryBuilder<T> {
  return client.from(table) as QueryBuilder<T>;
}

function firstOrganization(value: OrganizationRow | OrganizationRow[] | null): OrganizationRow | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export async function resolveCurrentContext(
  config: ApiConfig,
  authorization: string | undefined,
  dependencies: IdentityContextDependencies = {},
): Promise<CurrentContextResponse> {
  const token = bearerToken(authorization);
  const client = (dependencies.createClient ?? createSupabaseClient)(config, token);

  if (!client) {
    throw new IdentityError(500, "INTERNAL_ERROR", "Supabase ist nicht konfiguriert.");
  }

  const userResult = await client.auth.getUser(token);
  const user = userResult.data?.user ?? null;

  if (userResult.error || !user) {
    throw new IdentityError(401, "UNAUTHENTICATED", "Die Sitzung ist ungültig oder abgelaufen.");
  }

  const [profileResult, membershipsResult] = await Promise.all([
    query<ProfileRow>(client, "profiles").select("display_name").eq("id", user.id).maybeSingle(),
    query<MembershipRow>(client, "memberships")
      .select("id, role, status, employee_number, organization:organizations(id, name, slug, time_zone, logo_path)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
  ]);

  if (profileResult.error || membershipsResult.error) {
    throw new IdentityError(500, "INTERNAL_ERROR", "Der Benutzerkontext konnte nicht geladen werden.");
  }

  const memberships = (membershipsResult.data ?? []).flatMap((membership) => {
    const organization = firstOrganization(membership.organization);
    if (!organization) return [];

    return [
      {
        id: membership.id,
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          timeZone: organization.time_zone,
          ...(organization.logo_path ? { logoUrl: organization.logo_path } : {}),
        },
        role: membership.role,
        status: membership.status,
        ...(membership.employee_number ? { employeeNumber: membership.employee_number } : {}),
      },
    ];
  });

  return {
    user: {
      id: user.id,
      displayName:
        profileResult.data?.display_name ??
        user.user_metadata?.full_name ??
        user.user_metadata?.name ??
        user.email ??
        "TeamZeit",
      email: user.email ?? "",
    },
    memberships,
    issuedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
  };
}
