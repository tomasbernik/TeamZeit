import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type {
  CurrentContextResponse,
  DailyAttendanceOverview,
  MembershipRole,
  MembershipStatus,
  MonthlyAttendanceOverview,
  TodayAttendanceResponse,
  WorkSessionDto,
} from "@teamzeit/contracts";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";

const session = { access_token: "valid-token" } as Session;
const secondSession = { access_token: "second-token" } as Session;
const workSession: WorkSessionDto = {
  id: "session-1",
  organizationId: "employee-org",
  membershipId: "server-membership",
  workDate: "2026-07-16",
  startedAt: "2026-07-16T07:00:00.000Z",
  endedAt: "2026-07-16T15:30:00.000Z",
  workedMinutes: 480,
  breaks: [{ id: "break-1", startedAt: "2026-07-16T10:00:00.000Z", endedAt: "2026-07-16T10:30:00.000Z", durationMinutes: 30 }],
  state: "working",
  source: "clock",
  version: 3,
};

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

function context(role: MembershipRole = "employee", memberships = [membership(role)]): CurrentContextResponse {
  return {
    user: { id: "user-1", displayName: "Ada Lovelace", email: "ada@example.test" },
    memberships,
    issuedAt: "2026-07-16T10:00:00.000Z",
  };
}

function supabaseClient(currentSession: Session | null = session): SupabaseClient {
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
      signOut: vi.fn(async () => ({ error: null })),
    },
  } as unknown as SupabaseClient;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function today(state: TodayAttendanceResponse["state"] = "working"): TodayAttendanceResponse {
  return {
    serverTime: "2026-07-16T12:00:00.000Z",
    state,
    ...(state === "not_started" ? {} : { activeSession: { ...workSession, state } }),
  };
}

function daily(sessionItem: WorkSessionDto | null = workSession): DailyAttendanceOverview {
  return {
    workDate: "2026-07-16",
    state: sessionItem?.state ?? "not_started",
    sessions: sessionItem ? [sessionItem] : [],
    workedMinutes: sessionItem?.workedMinutes ?? 0,
    breakMinutes: breakMinutes(sessionItem),
  };
}

function monthly(sessionItem: WorkSessionDto | null = workSession): MonthlyAttendanceOverview {
  return {
    month: "2026-07",
    days: sessionItem ? [daily(sessionItem)] : [],
    workedMinutes: sessionItem?.workedMinutes ?? 0,
    breakMinutes: breakMinutes(sessionItem),
  };
}

function breakMinutes(sessionItem: WorkSessionDto | null): number {
  return sessionItem?.breaks.reduce((total, item) => total + (item.durationMinutes ?? 0), 0) ?? 0;
}

function attendanceFetch(state: TodayAttendanceResponse["state"] = "working") {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/attendance/today")) return jsonResponse(today(state));
    if (url.includes("/attendance/days/")) return jsonResponse(daily(state === "not_started" ? null : { ...workSession, state }));
    if (url.includes("/attendance/months/")) return jsonResponse(monthly(state === "not_started" ? null : { ...workSession, state }));
    if (url.endsWith("/attendance/commands/break-start") && init?.method === "POST") {
      return jsonResponse({ serverTime: "2026-07-16T12:01:00.000Z", session: { ...workSession, state: "on_break" } });
    }
    if (url.endsWith("/corrections") && init?.method === "POST") {
      return jsonResponse({ id: "correction-1", status: "pending" }, 201);
    }
    return jsonResponse({ error: { code: "NOT_FOUND", message: "Nicht gefunden.", requestId: "test" } }, 404);
  });
}

async function renderAttendance(
  options: {
    role?: MembershipRole;
    fetcher?: ReturnType<typeof vi.fn>;
    currentSession?: Session | null;
    currentContext?: CurrentContextResponse;
  } = {},
) {
  const fetcher = options.fetcher ?? attendanceFetch();
  vi.stubGlobal("fetch", fetcher);

  render(
    <MemoryRouter initialEntries={["/attendance"]}>
      <App
        authDependencies={{
          supabaseClient: supabaseClient(options.currentSession ?? session),
          fetchContext: async () => options.currentContext ?? context(options.role ?? "employee"),
        }}
      />
    </MemoryRouter>,
  );

  expect(await screen.findByRole("heading", { name: "Dochádzka" })).toBeInTheDocument();
  await waitFor(() => expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(3));
  return fetcher;
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AttendancePage", () => {
  it("loads attendance over the authenticated API context", async () => {
    const fetcher = await renderAttendance();

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/attendance/today",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer valid-token",
          "X-Organization-Id": "employee-org",
        },
      }),
    );
  });

  it("enables only commands valid for the current workday state", async () => {
    await renderAttendance();

    expect(screen.getByRole("button", { name: "Príchod" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Začať prestávku" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Ukončiť prestávku" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Odchod" })).toBeEnabled();
  });

  it.each([
    ["not_started", { clockIn: true, breakStart: false, breakEnd: false, clockOut: false }],
    ["working", { clockIn: false, breakStart: true, breakEnd: false, clockOut: true }],
    ["on_break", { clockIn: false, breakStart: false, breakEnd: true, clockOut: false }],
    ["completed", { clockIn: false, breakStart: false, breakEnd: false, clockOut: false }],
  ] as const)("sets command availability for %s state", async (state, expected) => {
    await renderAttendance({ fetcher: attendanceFetch(state) });

    expect(screen.getByRole("button", { name: "Príchod" })).toHaveProperty("disabled", !expected.clockIn);
    expect(screen.getByRole("button", { name: "Začať prestávku" })).toHaveProperty("disabled", !expected.breakStart);
    expect(screen.getByRole("button", { name: "Ukončiť prestávku" })).toHaveProperty("disabled", !expected.breakEnd);
    expect(screen.getByRole("button", { name: "Odchod" })).toHaveProperty("disabled", !expected.clockOut);
  });

  it("sends write commands once with an idempotency key", async () => {
    let resolveCommand!: () => void;
    const commandGate = new Promise<void>((resolve) => {
      resolveCommand = resolve;
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/attendance/today")) return jsonResponse(today("working"));
      if (url.includes("/attendance/days/")) return jsonResponse(daily());
      if (url.includes("/attendance/months/")) return jsonResponse(monthly());
      if (url.endsWith("/attendance/commands/break-start") && init?.method === "POST") {
        await commandGate;
        return jsonResponse({ serverTime: "2026-07-16T12:01:00.000Z", session: { ...workSession, state: "on_break" } });
      }
      return jsonResponse({});
    });

    await renderAttendance({ fetcher });

    const startBreak = screen.getByRole("button", { name: "Začať prestávku" });
    fireEvent.click(startBreak);
    fireEvent.click(startBreak);

    await waitFor(() => expect(screen.getByRole("button", { name: "Wird gesendet." })).toBeDisabled());
    const commandCalls = fetcher.mock.calls.filter(([url]) => String(url).endsWith("/attendance/commands/break-start"));
    expect(commandCalls).toHaveLength(1);
    expect(commandCalls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer valid-token",
          "X-Organization-Id": "employee-org",
          "Idempotency-Key": "00000000-0000-4000-8000-000000000001",
        }),
      }),
    );

    resolveCommand();
    await screen.findByText("Arbeitszeit wurde aktualisiert.");
  });

  it("reuses a command idempotency key when retrying after a network error", async () => {
    let keyCounter = 0;
    vi.mocked(crypto.randomUUID).mockImplementation(() => `00000000-0000-4000-8000-00000000000${++keyCounter}`);
    let commandAttempts = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/attendance/today")) return jsonResponse(today("working"));
      if (url.includes("/attendance/days/")) return jsonResponse(daily());
      if (url.includes("/attendance/months/")) return jsonResponse(monthly());
      if (url.endsWith("/attendance/commands/break-start") && init?.method === "POST") {
        commandAttempts += 1;
        if (commandAttempts === 1) throw new TypeError("network");
        return jsonResponse({ serverTime: "2026-07-16T12:01:00.000Z", session: { ...workSession, state: "on_break" } });
      }
      return jsonResponse({});
    });

    await renderAttendance({ fetcher });

    fireEvent.click(screen.getByRole("button", { name: "Začať prestávku" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Začať prestávku" }));
    await screen.findByText("Arbeitszeit wurde aktualisiert.");

    const commandCalls = fetcher.mock.calls.filter(([url]) => String(url).endsWith("/attendance/commands/break-start"));
    expect(commandCalls.map(([, init]) => (init?.headers as Record<string, string>)["Idempotency-Key"])).toEqual([
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000001",
    ]);
  });

  it("submits correction requests without caller-supplied membership or employee ids", async () => {
    const fetcher = await renderAttendance();

    fireEvent.change(screen.getByLabelText("Begründung"), { target: { value: "Ende wurde vergessen." } });
    fireEvent.submit(screen.getByRole("button", { name: "Korrektur senden" }).closest("form") as HTMLFormElement);

    await screen.findByText("Korrekturanfrage wurde gesendet.");
    const correctionCall = fetcher.mock.calls.find(([url]) => String(url).endsWith("/corrections"));
    expect(correctionCall?.[1]?.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer valid-token",
        "X-Organization-Id": "employee-org",
        "Idempotency-Key": "00000000-0000-4000-8000-000000000001",
      }),
    );

    const body = JSON.parse(String(correctionCall?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ sessionId: "session-1", expectedVersion: 3, reason: "Ende wurde vergessen." });
    expect(body).not.toHaveProperty("membershipId");
    expect(body).not.toHaveProperty("employeeId");
  });

  it("does not create a second correction request for a repeated in-flight form submit", async () => {
    let resolveCorrection!: () => void;
    const correctionGate = new Promise<void>((resolve) => {
      resolveCorrection = resolve;
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/attendance/today")) return jsonResponse(today("working"));
      if (url.includes("/attendance/days/")) return jsonResponse(daily());
      if (url.includes("/attendance/months/")) return jsonResponse(monthly());
      if (url.endsWith("/corrections") && init?.method === "POST") {
        await correctionGate;
        return jsonResponse({ id: "correction-1", status: "pending" }, 201);
      }
      return jsonResponse({});
    });

    await renderAttendance({ fetcher });

    fireEvent.change(screen.getByLabelText("Begründung"), { target: { value: "Ende wurde vergessen." } });
    const form = screen.getByRole("button", { name: "Korrektur senden" }).closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(screen.getByRole("button", { name: "Wird gesendet." })).toBeDisabled());
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/corrections"))).toHaveLength(1);
    resolveCorrection();
    await screen.findByText("Korrekturanfrage wurde gesendet.");
  });

  it("reuses a correction idempotency key when retrying after a network error", async () => {
    let keyCounter = 0;
    vi.mocked(crypto.randomUUID).mockImplementation(() => `00000000-0000-4000-8000-00000000000${++keyCounter}`);
    let correctionAttempts = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/attendance/today")) return jsonResponse(today("working"));
      if (url.includes("/attendance/days/")) return jsonResponse(daily());
      if (url.includes("/attendance/months/")) return jsonResponse(monthly());
      if (url.endsWith("/corrections") && init?.method === "POST") {
        correctionAttempts += 1;
        if (correctionAttempts === 1) throw new TypeError("network");
        return jsonResponse({ id: "correction-1", status: "pending" }, 201);
      }
      return jsonResponse({});
    });

    await renderAttendance({ fetcher });

    fireEvent.change(screen.getByLabelText("Begründung"), { target: { value: "Ende wurde vergessen." } });
    const form = screen.getByRole("button", { name: "Korrektur senden" }).closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    await screen.findByRole("alert");
    fireEvent.change(screen.getByLabelText("Begründung"), { target: { value: "Ende wurde vergessen." } });
    fireEvent.submit(form);
    await screen.findByText("Korrekturanfrage wurde gesendet.");

    const correctionCalls = fetcher.mock.calls.filter(([url]) => String(url).endsWith("/corrections"));
    expect(correctionCalls.map(([, init]) => (init?.headers as Record<string, string>)["Idempotency-Key"])).toEqual([
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000001",
    ]);
  });

  it("renders empty and error states", async () => {
    const fetcher = attendanceFetch("not_started");
    await renderAttendance({ fetcher });

    expect(screen.getByText("Für diesen Tag gibt es noch keine Einträge.")).toBeInTheDocument();
    expect(screen.getByText("Für diesen Monat gibt es noch keine freigegebenen Tageswerte.")).toBeInTheDocument();

    const errorFetch = vi.fn(async () => jsonResponse({ error: { code: "FORBIDDEN", message: "Keine aktive Mitgliedschaft.", requestId: "test" } }, 403));
    cleanup();
    await renderAttendance({ fetcher: errorFetch });

    expect(screen.getByRole("alert")).toHaveTextContent("Keine aktive Mitgliedschaft.");
  });

  it("shows an understandable expired-session error from attendance reads", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: { code: "UNAUTHENTICATED", message: "Die Sitzung ist abgelaufen.", requestId: "test" } }, 401),
    );

    await renderAttendance({ fetcher, currentSession: secondSession });

    expect(screen.getByRole("alert")).toHaveTextContent("Die Sitzung ist abgelaufen.");
  });

  it("does not expose technical details from server errors", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: { code: "INTERNAL_ERROR", message: "stack trace: database password", requestId: "test" } }, 500),
    );

    await renderAttendance({ fetcher });

    expect(screen.getByRole("alert")).toHaveTextContent("Der heutige Arbeitsstand konnte nicht geladen werden.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("database password");
  });

  it("hides previous attendance data immediately when the active organisation changes", async () => {
    const employeeMembership = membership("employee");
    const adminMembership = membership("admin");
    let resolveAdminToday!: (response: Response) => void;
    const adminTodayGate = new Promise<Response>((resolve) => {
      resolveAdminToday = resolve;
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const organizationId = (init?.headers as Record<string, string> | undefined)?.["X-Organization-Id"];
      if (url.endsWith("/attendance/today")) {
        if (organizationId === "admin-org") return adminTodayGate;
        return jsonResponse(today("working"));
      }
      if (url.includes("/attendance/days/")) {
        const sessionItem = organizationId === "admin-org" ? { ...workSession, id: "admin-session", workedMinutes: 120 } : workSession;
        return jsonResponse(daily(sessionItem));
      }
      if (url.includes("/attendance/months/")) {
        const sessionItem = organizationId === "admin-org" ? { ...workSession, id: "admin-session", workedMinutes: 120 } : workSession;
        return jsonResponse(monthly(sessionItem));
      }
      return jsonResponse({});
    });

    await renderAttendance({
      fetcher,
      currentContext: context("employee", [employeeMembership, adminMembership]),
    });
    expect(screen.getAllByText(/8 h 00 min/).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Organisation"), { target: { value: "admin-org" } });

    expect(await screen.findByText("Arbeitsstand wird geladen.")).toBeInTheDocument();
    expect(screen.queryByText(/8 h 00 min/)).not.toBeInTheDocument();
    resolveAdminToday(jsonResponse({ ...today("working"), activeSession: { ...workSession, workedMinutes: 120 } }));
    expect(await screen.findAllByText(/2 h 00 min/)).not.toHaveLength(0);
  });

  it("keeps attendance writes disabled for auditors", async () => {
    await renderAttendance({ role: "auditor" });

    const panel = screen.getByRole("heading", { name: "Aktueller Status" }).closest("section") as HTMLElement;
    expect(within(panel).getByRole("button", { name: "Začať prestávku" })).toBeDisabled();
    expect(screen.getByText("Auditoren können Arbeitszeiten nur lesen.")).toBeInTheDocument();
  });
});
