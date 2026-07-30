import type { CreateAbsenceRequest, ReviewAbsenceRequest, UUID } from "@teamzeit/contracts";
import { TimeTrackingError } from "../time-tracking/errors.js";
import type { AbsenceActor, AbsenceRepository } from "./types.js";

export class AbsenceService {
  constructor(private readonly repository: AbsenceRepository) {}
  list(actor: AbsenceActor) { return this.repository.list(actor); }
  create(actor: AbsenceActor, key: UUID, input: CreateAbsenceRequest) {
    if (actor.role === "auditor") throw new TimeTrackingError("FORBIDDEN", "Keine Berechtigung für Abwesenheitsanträge.");
    if (input.endsOn < input.startsOn) throw new TimeTrackingError("VALIDATION_ERROR", "Das Enddatum darf nicht vor dem Startdatum liegen.", "endsOn");
    return this.repository.command(actor, "create", key, input as unknown as Record<string, unknown>);
  }
  cancel(actor: AbsenceActor, id: UUID, key: UUID, expectedVersion: number) {
    return this.repository.command(actor, "cancel", key, { id, expectedVersion });
  }
  review(actor: AbsenceActor, id: UUID, key: UUID, input: ReviewAbsenceRequest) {
    if (!["owner", "admin", "manager"].includes(actor.role)) throw new TimeTrackingError("FORBIDDEN", "Keine Berechtigung zur Prüfung.");
    return this.repository.command(actor, "review", key, { id, ...input });
  }
}
