import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "../auth/AuthProvider";
import * as api from "../employees/api";
import { EmployeesPage } from "./EmployeesPage";

vi.mock("../auth/AuthProvider", () => ({ useAuth: vi.fn() }));
vi.mock("../employees/api", () => ({
  createEmployee: vi.fn(),
  deactivateEmployee: vi.fn(),
  getEmployeeWorkRule: vi.fn(),
  listEmployees: vi.fn(),
  sendEmployeeInvitation: vi.fn(),
  setEmployeeWorkRule: vi.fn(),
  updateEmployee: vi.fn(),
}));

const employee = {
  id: "00000000-0000-4000-8000-000000000010",
  email: "employee@example.test",
  role: "employee" as const,
  status: "active" as const,
  version: 2,
};

describe("EmployeesPage", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      session: { access_token: "token" },
      activeMembership: {
        id: "00000000-0000-4000-8000-000000000002",
        role: "owner",
        organization: { id: "00000000-0000-4000-8000-000000000001" },
      },
    } as never);
    vi.mocked(api.listEmployees).mockResolvedValue([employee]);
    vi.mocked(api.getEmployeeWorkRule).mockResolvedValue({
      rule: {
        id: "00000000-0000-4000-8000-000000000020",
        organizationId: "00000000-0000-4000-8000-000000000001",
        membershipId: employee.id,
        effectiveFrom: "2026-07-01",
        weekdayMinutes: {
          monday: 360,
          tuesday: 360,
          wednesday: 360,
          thursday: 360,
          friday: 300,
          saturday: 0,
          sunday: 0,
        },
        breakThresholdMinutes: 360,
        minimumBreakMinutes: 30,
      },
    });
  });

  it("loads the effective work rule into the administration form", async () => {
    render(<EmployeesPage />);

    expect(await screen.findByRole("heading", { name: employee.email })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Mo")).toHaveValue(6));
    expect(screen.getByText(/Aktuelle Regel gültig seit 0?1\.0?7\.2026\./)).toBeInTheDocument();
  });

  it("confirms and deactivates an active membership using its current version", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.deactivateEmployee).mockResolvedValue({ ...employee, status: "inactive", version: 3 });
    vi.mocked(api.listEmployees)
      .mockResolvedValueOnce([employee])
      .mockResolvedValueOnce([{ ...employee, status: "inactive", version: 3 }]);
    render(<EmployeesPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Mitgliedschaft deaktivieren" }));

    await waitFor(() => expect(api.deactivateEmployee).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "00000000-0000-4000-8000-000000000001" }),
      employee.id,
      2,
    ));
    expect(await screen.findByText("Die Mitgliedschaft wurde deaktiviert.")).toBeInTheDocument();
    expect(screen.getByText("Inaktive Mitgliedschaften können nicht bearbeitet werden.")).toBeInTheDocument();
    confirm.mockRestore();
  });
});
