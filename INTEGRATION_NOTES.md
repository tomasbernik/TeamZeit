# Integration notes

## Time Tracking domain logic

The API service now contains a module-local time tracking domain service in `services/api/src/time-tracking`.
It implements clock-in, break start/end, clock-out, current state, daily overview, monthly overview,
worked-time calculations, correction submission/review, idempotency handling, invalid transition checks,
clock evidence, and audit events through explicit ports.

No shared authentication, organisation, absence, or user model was changed. The service expects the future API
handler to pass an already authorised membership context and to implement the repository, period guard, and audit
ports against the database transaction layer.

OpenAPI currently defines `/attendance/today`, `/attendance/sessions`, clock commands, and correction commands.
It does not yet define dedicated daily and monthly overview response schemas or endpoints. Before wiring public
routes, coordinate additive contract entries for these read models instead of redefining DTOs in a neighbouring
module.

The correction approval implementation stores a single synthetic break interval when an approved correction
contains only aggregate `breakMinutes`, because the current shared `CorrectionValues` contract has aggregate
break minutes rather than exact corrected break intervals. If exact break reconstruction is required, coordinate
an additive contract change for proposed break intervals.
