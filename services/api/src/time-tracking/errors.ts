import type { ApiError } from "@teamzeit/contracts";

export type TimeTrackingErrorCode = ApiError["error"]["code"];

export class TimeTrackingError extends Error {
  public readonly code: TimeTrackingErrorCode;
  public readonly field: string | undefined;

  public constructor(code: TimeTrackingErrorCode, message: string, field?: string) {
    super(message);
    this.name = "TimeTrackingError";
    this.code = code;
    this.field = field;
  }
}

export function invalidState(message: string): TimeTrackingError {
  return new TimeTrackingError("INVALID_STATE", message);
}

export function conflict(message: string, field?: string): TimeTrackingError {
  return new TimeTrackingError("CONFLICT", message, field);
}

export function validationError(message: string, field?: string): TimeTrackingError {
  return new TimeTrackingError("VALIDATION_ERROR", message, field);
}
