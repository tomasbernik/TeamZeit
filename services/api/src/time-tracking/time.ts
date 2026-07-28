import type { ISODate, ISOInstant, IanaTimeZone } from "@teamzeit/contracts";

export function toIsoInstant(date: Date): ISOInstant {
  return date.toISOString();
}

export function minutesBetween(startedAt: ISOInstant, endedAt: ISOInstant): number {
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  return Math.max(0, Math.floor((end - start) / 60_000));
}

export function localDateForInstant(instant: ISOInstant, timeZone: IanaTimeZone): ISODate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error(`Could not derive local date for time zone ${timeZone}`);
  }

  return `${year}-${month}-${day}`;
}

export function monthBounds(month: string): { from: ISODate; to: ISODate } {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("Month must use YYYY-MM format");
  }

  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const from = new Date(Date.UTC(year, monthIndex, 1));
  const to = new Date(Date.UTC(year, monthIndex + 1, 0));

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function nextDate(date: ISODate): ISODate {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

/** Resolves local midnight without assuming a fixed UTC offset or ignoring DST. */
export function localMidnightInstant(date: ISODate, timeZone: IanaTimeZone): ISOInstant {
  const [year, month, day] = date.split("-").map(Number);
  let candidate = Date.UTC(year!, month! - 1, day!);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    candidate += Date.UTC(year!, month! - 1, day!) - represented;
  }
  return new Date(candidate).toISOString();
}
