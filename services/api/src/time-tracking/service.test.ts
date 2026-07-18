import { describe, expect, it } from "vitest";
import { InMemoryTimeTrackingRepository } from "./memory-repository.js";
import { TimeTrackingService } from "./service.js";
import type { AttendanceMembershipContext } from "./types.js";

const context: AttendanceMembershipContext = { organizationId: "00000000-0000-4000-8000-000000000001", membershipId: "00000000-0000-4000-8000-000000000002", userId: "00000000-0000-4000-8000-000000000003", organizationTimeZone: "Europe/Berlin" };
const ids = Array.from({ length: 30 }, (_, index) => `00000000-0000-4000-8000-${(100000000000 + index).toString()}`);
function setup(now = "2026-07-17T06:00:00.000Z") {
  const repository = new InMemoryTimeTrackingRepository(); let current = new Date(now); let index = 0;
  const service = new TimeTrackingService({ repository, periodGuard: { assertPeriodOpen: async () => undefined }, clock: { now: () => current }, ids: { uuid: () => ids[index++]! } });
  return { repository, service, setNow: (value: string) => { current = new Date(value); } };
}
describe("interval time tracking", () => {
  it("opens and closes multiple intervals and derives the break gap", async () => {
    const { service, setNow } = setup();
    await service.clockIn(context, ids[20]!); setNow("2026-07-17T10:00:00.000Z"); await service.clockOut(context, ids[21]!);
    setNow("2026-07-17T10:30:00.000Z"); await service.clockIn(context, ids[22]!); setNow("2026-07-17T12:30:00.000Z"); await service.clockOut(context, ids[23]!);
    const day = await service.getDailyOverview(context, "2026-07-17");
    expect(day.sessions).toHaveLength(2); expect(day.workedMinutes).toBe(360); expect(day.breakMinutes).toBe(30);
  });
  it("is idempotent and prevents a second open interval", async () => {
    const { service, repository } = setup(); const requestId = ids[20]!;
    const first = await service.clockIn(context, requestId); const retry = await service.clockIn(context, requestId);
    expect(retry).toEqual(first); expect(repository.sessions.size).toBe(1);
    await expect(service.clockIn(context, ids[21]!)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
  it("immediately creates, updates and archives only own non-overlapping intervals with audit", async () => {
    const { service, repository } = setup();
    const created = await service.createSession(context, ids[20]!, { workDate: "2026-07-17", startedAt: "2026-07-17T06:00:00.000Z", endedAt: "2026-07-17T08:00:00.000Z" });
    const updated = await service.updateSession(context, created.id, ids[21]!, { workDate: "2026-07-17", startedAt: "2026-07-17T06:30:00.000Z", endedAt: "2026-07-17T08:30:00.000Z", expectedVersion: 1 });
    await expect(service.createSession(context, ids[22]!, { workDate: "2026-07-17", startedAt: "2026-07-17T08:00:00.000Z", endedAt: "2026-07-17T09:00:00.000Z" })).rejects.toMatchObject({ code: "CONFLICT" });
    await service.archiveSession(context, updated.id, ids[23]!, 2);
    expect(repository.auditEvents.map((event) => event.action)).toEqual(["work_session.created", "work_session.updated", "work_session.archived"]);
  });
});
