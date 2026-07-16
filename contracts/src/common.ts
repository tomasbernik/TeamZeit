export type UUID = string;
export type ISODate = string; // YYYY-MM-DD
export type ISOInstant = string; // ISO 8601 UTC instant
export type IanaTimeZone = string;

export interface ApiError {
  error: {
    code:
      | "UNAUTHENTICATED"
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "VALIDATION_ERROR"
      | "CONFLICT"
      | "PERIOD_CLOSED"
      | "INVALID_STATE"
      | "RATE_LIMITED"
      | "INTERNAL_ERROR";
    message: string;
    field?: string;
    requestId: string;
  };
}

export interface PageInfo {
  nextCursor?: string;
}

export interface Paginated<T> {
  items: T[];
  page: PageInfo;
}
