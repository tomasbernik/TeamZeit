import type { MonthlyAttendanceReport } from "@teamzeit/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TimeTrackingError } from "../time-tracking/errors.js";
import type { ReportingActor, ReportingRepository } from "./types.js";

interface Result<T> { data: T | null; error: { message: string } | null; }
interface Client { rpc<T>(fn: string, args: Record<string, unknown>): Promise<Result<T>>; }

export class PostgresReportingRepository implements ReportingRepository {
  private readonly client: Client;
  public constructor(client: SupabaseClient) { this.client = client as unknown as Client; }

  public async monthlyAttendance(actor: ReportingActor, month: string): Promise<MonthlyAttendanceReport> {
    const result = await this.client.rpc<MonthlyAttendanceReport>("reporting_monthly_attendance", {
      target_organization_id: actor.organizationId,
      actor_membership_id: actor.membershipId,
      actor_user_id: actor.userId,
      target_month: `${month}-01`,
    });
    if (result.error || !result.data) {
      if (result.error?.message.includes("reporting_forbidden")) throw new TimeTrackingError("FORBIDDEN", "Keine Berechtigung für Berichte.");
      throw new TimeTrackingError("INTERNAL_ERROR", "Der Monatsbericht konnte nicht geladen werden.");
    }
    return result.data;
  }
}
