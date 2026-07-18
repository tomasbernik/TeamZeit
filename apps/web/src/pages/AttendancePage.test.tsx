import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttendancePage } from "./AttendancePage";
import { useAuth } from "../auth/AuthProvider";
import * as api from "../time-tracking/api";

vi.mock("../auth/AuthProvider", () => ({ useAuth: vi.fn() }));
vi.mock("../time-tracking/api", async () => ({
  fetchTodayAttendance: vi.fn(), fetchDailyAttendance: vi.fn(), fetchMonthlyAttendance: vi.fn(), sendClockCommand: vi.fn(),
  createWorkSession: vi.fn(), updateWorkSession: vi.fn(), deleteWorkSession: vi.fn(),
}));
const session = { id: "s", organizationId: "00000000-0000-4000-8000-000000000001", membershipId: "00000000-0000-4000-8000-000000000002", workDate: "2026-07-17", startedAt: "2026-07-17T06:00:00.000Z", endedAt: "2026-07-17T10:00:00.000Z", breaks: [], workedMinutes: 240, state: "not_started" as const, source: "clock" as const, version: 2 };
describe("AttendancePage", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ session: { access_token: "token" } as never, activeMembership: { role: "employee", organization: { id: session.organizationId } } as never } as never);
    vi.mocked(api.fetchTodayAttendance).mockResolvedValue({ serverTime: "2026-07-17T10:00:00.000Z", workDate: "2026-07-17", state: "not_started", sessions: [session], workedMinutes: 240, breakMinutes: 0 });
    vi.mocked(api.fetchDailyAttendance).mockResolvedValue({ workDate: "2026-07-17", state: "not_started", sessions: [session], workedMinutes: 240, breakMinutes: 0 });
    vi.mocked(api.fetchMonthlyAttendance).mockResolvedValue({ month: "2026-07", days: [], workedMinutes: 240, breakMinutes: 0 });
  });
  it("shows only Einstempeln when no interval is open", async () => { render(<AttendancePage todayOnly />); expect(await screen.findByRole("button", { name: "Einstempeln" })).toBeInTheDocument(); expect(screen.queryByText(/Pause starten/i)).not.toBeInTheDocument(); });
  it("shows intervals and immediate edit actions", async () => { render(<AttendancePage />); await waitFor(() => expect(screen.getByText("08:00 – 12:00")).toBeInTheDocument()); expect(screen.getAllByRole("button", { name: "Bearbeiten" })).toHaveLength(1); expect(screen.getByRole("button", { name: "Intervall hinzufügen" })).toBeInTheDocument(); });
});
