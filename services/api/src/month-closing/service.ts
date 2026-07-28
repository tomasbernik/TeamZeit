import type { MonthClosureDto, UUID } from "@teamzeit/contracts";
import { TimeTrackingError } from "../time-tracking/errors.js";
import type { MonthClosingActor, MonthClosingRepository } from "./types.js";
export class MonthClosingService {
  public constructor(private readonly repository: MonthClosingRepository, private readonly now: () => Date = () => new Date()) {}
  public async getStatus(actor: MonthClosingActor, membershipId: UUID, month: string): Promise<MonthClosureDto> { const start = monthStart(month); return await this.repository.get(actor.organizationId, membershipId, start) ?? { organizationId: actor.organizationId, membershipId, monthStart: start, status: "open" }; }
  public async close(actor: MonthClosingActor, requestId: UUID, membershipId: UUID, month: string, reason: string) { return this.repository.close(this.command(actor, requestId, membershipId, month, reason)); }
  public async reopen(actor: MonthClosingActor, requestId: UUID, membershipId: UUID, month: string, reason: string) { return this.repository.reopen(this.command(actor, requestId, membershipId, month, reason)); }
  private command(actor: MonthClosingActor, requestId: UUID, targetMembershipId: UUID, month: string, reason: string) { const normalizedReason = reason.trim(); if (normalizedReason.length < 3 || normalizedReason.length > 500) throw new TimeTrackingError("VALIDATION_ERROR", "Der Grund muss zwischen 3 und 500 Zeichen lang sein.", "reason"); return { ...actor, targetMembershipId, monthStart: monthStart(month), reason: normalizedReason, requestId, occurredAt: this.now().toISOString() }; }
}
function monthStart(month: string): string { const match = /^(\d{4})-(\d{2})$/u.exec(month); const numericMonth = Number(match?.[2]); if (!match || numericMonth < 1 || numericMonth > 12) throw new TimeTrackingError("VALIDATION_ERROR", "Der Monat muss das Format YYYY-MM verwenden.", "month"); return `${match[1]}-${match[2]}-01`; }
