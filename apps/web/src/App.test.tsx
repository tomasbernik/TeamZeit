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
});

afterEach(() => {
  cleanup();
});

describe("TeamZeit authentication shell", () => {
  it("redirects protected routes to login without a session", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App authDependencies={{ supabaseClient: supabaseClient(null) }} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Einfach im Team arbeiten." })).toBeInTheDocument();
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
