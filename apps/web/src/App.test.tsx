import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { App } from "./App";

describe("TeamZeit application shell", () => {
  it("renders the Today placeholder and navigation", () => {
    render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Heute" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Zeiterfassung/ })).toBeInTheDocument();
  });

  it("renders the login placeholder", () => {
    render(<MemoryRouter initialEntries={["/login"]}><App /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Einfach im Team arbeiten." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mit E-Mail anmelden" })).toBeDisabled();
  });
});
