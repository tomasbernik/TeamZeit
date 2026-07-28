import { describe, expect, it, vi } from "vitest";
import { SupabaseInvitationDelivery } from "./supabase-invitation-delivery.js";

describe("SupabaseInvitationDelivery", () => {
  it("sends an Auth invitation with the configured web redirect", async () => {
    const inviteUserByEmail = vi.fn().mockResolvedValue({
      data: { user: { id: "10000000-0000-4000-8000-000000000001" } },
      error: null,
    });
    const delivery = new SupabaseInvitationDelivery({ auth: { admin: { inviteUserByEmail } } } as never, "https://teamzeit.example");

    await expect(delivery.send("employee@example.test")).resolves.toEqual({
      userId: "10000000-0000-4000-8000-000000000001",
    });
    expect(inviteUserByEmail).toHaveBeenCalledWith("employee@example.test", {
      redirectTo: "https://teamzeit.example",
    });
  });

  it("does not report a failed provider request as sent", async () => {
    const delivery = new SupabaseInvitationDelivery({
      auth: { admin: { inviteUserByEmail: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: "SMTP failed" } }) } },
    } as never, "https://teamzeit.example");

    await expect(delivery.send("employee@example.test")).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });
});
