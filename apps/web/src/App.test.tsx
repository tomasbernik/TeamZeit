import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { CurrentContextResponse, MembershipRole, MembershipStatus } from "@teamzeit/contracts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

const session = { access_token: "valid-token" } as Session;

function membership(role: MembershipRole, status: MembershipStatus = "active") {
  return {
    id: `${role}-membership`,
    role,
    status,
    organization: {
      id: `${role}-org`,
      name: `${role} GmbH`,
      slug: role,
      timeZone: "Europe/Berlin",
    },
  };
}

function context(memberships = [membership("employee")]): CurrentContextResponse {
  return {
    user: { id: "user-1", displayName: "Ada Lovelace", email: "ada@example.test" },
    memberships,
    issuedAt: "2026-07-16T10:00:00.000Z",
  };
}

function supabaseClient(
  currentSession: Session | null = session,
  signOut: () => Promise<{ error: Error | null }> = vi.fn(async () => ({ error: null })),
): SupabaseClient {
  return {
    auth: {
      async getSession() {
        return { data: { session: currentSession }, error: null };
      },
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
      signInWithOAuth: vi.fn(async () => ({ data: { provider: "google", url: null }, error: null })),
      signOut,
    },
  } as unknown as SupabaseClient;
}

function deferredContext() {
  let resolve!: (value: CurrentContextResponse) => void;
  const promise = new Promise<CurrentContextResponse>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          serverTime: "2026-07-17T08:00:00.000Z",
          state: "not_started",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TeamZeit authentication shell", () => {
  it("redirects protected routes to login without a session", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App authDependencies={{ supabaseClient: supabaseClient(null) }} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Einfach im Team arbeiten." }, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it("renders protected navigation after restoring a session and active membership", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App authDependencies={{ supabaseClient: supabaseClient(), fetchContext: async () => context() }} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Heute" })).toBeInTheDocument();
    expect(screen.getAllByText("employee GmbH").length).toBeGreaterThan(0);
    expect(screen.getByText("Employee")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Einstellungen/ })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Príchod" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Začať prestávku" })).toBeDisabled();
    expect(screen.getByText("Heute wurde noch keine Arbeitszeit erfasst.")).toBeInTheDocument();
  });

  it("loads only the tenant-scoped current day on the Today dashboard", async () => {
    const fetcher = vi.mocked(fetch);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App authDependencies={{ supabaseClient: supabaseClient(), fetchContext: async () => context() }} />
      </MemoryRouter>,
    );

    await screen.findByRole("button", { name: "Príchod" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringMatching(/\/attendance\/today$/),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer valid-token",
          "X-Organization-Id": "employee-org",
        }),
      }),
    );
  });

  it("shows loading and a terminal error state on the Today dashboard", async () => {
    let rejectRequest!: (reason: Error) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        new Promise<Response>((_resolve, reject) => {
          rejectRequest = reject;
        }),
      ),
    );

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App authDependencies={{ supabaseClient: supabaseClient(), fetchContext: async () => context() }} />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Arbeitsstand wird geladen.")).toBeInTheDocument();
    await waitFor(() => expect(rejectRequest).toBeTypeOf("function"));
    rejectRequest(new TypeError("network"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Die Verbindung zum Server wurde unterbrochen.");
    expect(screen.queryByText("Arbeitsstand wird geladen.")).not.toBeInTheDocument();
  });

  it("submits a Today command once and applies its response before the refresh finishes", async () => {
    let resolveCommand!: (response: Response) => void;
    const pendingRefresh = new Promise<Response>(() => undefined);
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/attendance/commands/clock-in") && init?.method === "POST") {
        return new Promise<Response>((resolve) => {
          resolveCommand = resolve;
        });
      }

      if (fetcher.mock.calls.length > 2) return pendingRefresh;
      return Promise.resolve(
        new Response(JSON.stringify({ serverTime: "2026-07-17T08:00:00.000Z", state: "not_started" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetcher);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App authDependencies={{ supabaseClient: supabaseClient(), fetchContext: async () => context() }} />
      </MemoryRouter>,
    );

    const clockIn = await screen.findByRole("button", { name: "Príchod" });
    fireEvent.click(clockIn);
    fireEvent.click(clockIn);
    expect(await screen.findByRole("button", { name: "Wird gesendet." })).toBeDisabled();
    expect(fetcher.mock.calls.filter(([input]) => String(input).endsWith("/attendance/commands/clock-in"))).toHaveLength(1);

    resolveCommand(
      new Response(
        JSON.stringify({
          serverTime: "2026-07-17T08:01:00.000Z",
          session: {
            id: "session-1",
            organizationId: "employee-org",
            membershipId: "employee-membership",
            workDate: "2026-07-17",
            startedAt: "2026-07-17T08:01:00.000Z",
            breaks: [],
            state: "working",
            source: "clock",
            version: 1,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    expect(await screen.findByText("Arbeitszeit läuft")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Začať prestávku" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Odchod" })).toBeEnabled();
  });

  it("keeps protected content hidden while membership context is loading", async () => {
    const delayedContext = deferredContext();

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App authDependencies={{ supabaseClient: supabaseClient(), fetchContext: async () => delayedContext.promise }} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Sitzung wird geladen." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Heute" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Keine aktive Mitgliedschaft." })).not.toBeInTheDocument();

    delayedContext.resolve(context());

    expect(await screen.findByRole("heading", { name: "Heute" })).toBeInTheDocument();
  });

  it("allows selecting another active organisation without exposing inactive memberships", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App
          authDependencies={{
            supabaseClient: supabaseClient(),
            fetchContext: async () => context([membership("employee"), membership("admin"), membership("auditor", "inactive")]),
          }}
        />
      </MemoryRouter>,
    );

    const select = await screen.findByLabelText("Organisation");
    expect(screen.queryByRole("option", { name: "auditor GmbH" })).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: "admin-org" } });

    await waitFor(() => expect(screen.getByText("Admin")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Einstellungen/ })).toBeInTheDocument();
  });

  it("denies application access when the user has no active membership", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App authDependencies={{ supabaseClient: supabaseClient(), fetchContext: async () => context([membership("employee", "inactive")]) }} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Keine aktive Mitgliedschaft." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Heute" })).not.toBeInTheDocument();
  });

  it("clears the local session and active organisation when sign-out fails remotely", async () => {
    const failingSignOut = vi.fn(async () => {
      throw new Error("network");
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App authDependencies={{ supabaseClient: supabaseClient(session, failingSignOut), fetchContext: async () => context() }} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Heute" })).toBeInTheDocument();
    expect(localStorage.getItem("teamzeit.activeOrganizationId")).toBe("employee-org");

    fireEvent.click(screen.getByRole("button", { name: "Abmelden" }));

    expect(await screen.findByRole("heading", { name: "Einfach im Team arbeiten." })).toBeInTheDocument();
    expect(localStorage.getItem("teamzeit.activeOrganizationId")).toBeNull();
  });
});
