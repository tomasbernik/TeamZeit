import type { SupabaseClient } from "@supabase/supabase-js";
import { EmployeeAdministrationError, type InvitationDelivery } from "./administration.js";

export class SupabaseInvitationDelivery implements InvitationDelivery {
  public constructor(private readonly client: SupabaseClient, private readonly webOrigin: string) {}

  public async send(email: string): Promise<{ userId: string }> {
    const { data, error } = await this.client.auth.admin.inviteUserByEmail(email, { redirectTo: this.webOrigin });
    if (error || !data.user?.id) {
      throw new EmployeeAdministrationError("INTERNAL_ERROR", "Die Einladung konnte nicht per E-Mail versendet werden.");
    }
    return { userId: data.user.id };
  }
}
