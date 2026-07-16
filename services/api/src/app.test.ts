import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { readApiConfig } from "./config/env.js";

const apps: ReturnType<typeof buildApp>[] = [];
const testConfig = readApiConfig({
  NODE_ENV: "test",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "publishable-key",
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

interface FakeUser {
  id: string;
  email: string;
  user_metadata?: { full_name?: string };
}

interface FakeProfile {
  display_name: string | null;
}

interface FakeMembership {
  id: string;
  role: "owner" | "admin" | "manager" | "employee" | "auditor";
  status: "invited" | "active" | "inactive";
  employee_number: string | null;
  organization: {
    id: string;
    name: string;
    slug: string;
    time_zone: string;
    logo_path: string | null;
  };
}

class FakeQuery<T> implements PromiseLike<{ data: T[] | null; error: { message: string } | null }> {
  private selectedUserId: string | null = null;

  constructor(
    private readonly rows: T[],
    private readonly error: { message: string } | null = null,
  ) {}

  select() {
    return this;
  }

  eq(_column: string, value: string) {
    this.selectedUserId = value;
    return this;
  }

  order() {
    return this;
  }

  async maybeSingle() {
    return { data: this.rows[0] ?? null, error: this.error };
  }

  then<TResult1 = { data: T[] | null; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: T[] | null; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    void this.selectedUserId;
    return Promise.resolve({ data: this.rows, error: this.error }).then(onfulfilled, onrejected);
  }
}

function fakeClient({
  user,
  profile,
  memberships,
  queryError,
}: {
  user: FakeUser | null;
  profile?: FakeProfile;
  memberships?: FakeMembership[];
  queryError?: { message: string };
}) {
  return {
    auth: {
      async getUser() {
        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "invalid" } };
      },
    },
    from(table: string) {
      if (table === "profiles") return new FakeQuery(profile ? [profile] : [], queryError ?? null);
      if (table === "memberships") return new FakeQuery(memberships ?? [], queryError ?? null);
      throw new Error(`Unexpected table ${table}`);
    },
  };
}

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

  it("rejects current context requests without a bearer token", async () => {
    const app = buildApp(testConfig);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/v1/me" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("rejects current context requests with an invalid bearer token", async () => {
    const app = buildApp(testConfig, {
      createClient: () => fakeClient({ user: null }),
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: "Bearer invalid-token" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("returns the authenticated user and organisation memberships", async () => {
    const app = buildApp(testConfig, {
      createClient: () =>
        fakeClient({
          user: { id: "user-1", email: "ada@example.test" },
          profile: { display_name: "Ada" },
          memberships: [
            {
              id: "membership-1",
              role: "owner",
              status: "active",
              employee_number: "E-1",
              organization: {
                id: "org-1",
                name: "TeamZeit GmbH",
                slug: "teamzeit",
                time_zone: "Europe/Berlin",
                logo_path: null,
              },
            },
          ],
        }),
      now: () => new Date("2026-07-16T10:00:00.000Z"),
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: "Bearer valid-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: { id: "user-1", displayName: "Ada", email: "ada@example.test" },
      memberships: [
        {
          id: "membership-1",
          role: "owner",
          status: "active",
          employeeNumber: "E-1",
          organization: {
            id: "org-1",
            name: "TeamZeit GmbH",
            slug: "teamzeit",
            timeZone: "Europe/Berlin",
          },
        },
      ],
      issuedAt: "2026-07-16T10:00:00.000Z",
    });
  });

  it("keeps inactive memberships visible for the client to deny tenant access", async () => {
    const app = buildApp(testConfig, {
      createClient: () =>
        fakeClient({
          user: { id: "user-2", email: "audit@example.test" },
          memberships: [
            {
              id: "membership-2",
              role: "auditor",
              status: "inactive",
              employee_number: null,
              organization: {
                id: "org-2",
                name: "Inactive Org",
                slug: "inactive",
                time_zone: "Europe/Berlin",
                logo_path: null,
              },
            },
          ],
        }),
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: "Bearer valid-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().memberships).toHaveLength(1);
    expect(response.json().memberships[0]).toMatchObject({ status: "inactive", role: "auditor" });
  });
});
