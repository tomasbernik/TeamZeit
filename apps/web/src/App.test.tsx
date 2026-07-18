import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App";

afterEach(cleanup);
describe("TeamZeit application shell", () => {
  it("renders the login route without creating a parallel auth flow", async () => {
    render(<MemoryRouter initialEntries={["/login"]}><App authDependencies={{ supabaseClient: null }} /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Einfach im Team arbeiten." })).toBeInTheDocument();
  });
});
