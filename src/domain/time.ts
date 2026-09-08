export type HouseholdDate = string;

const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = dateFormatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateFormatterCache.set(timeZone, fmt);
  }
  return fmt;
}

/** Resolve the household-local calendar date for a UTC instant. */
export function householdDateFromInstant(instant: Date | string, timeZone: string): HouseholdDate {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid instant");
  }
  // en-CA yields YYYY-MM-DD
  return formatterFor(timeZone).format(date);
}

/** ISO weekday 1=Monday … 7=Sunday for a household-local YYYY-MM-DD. */
export function isoWeekdayForHouseholdDate(householdDate: HouseholdDate): number {
  const [y, m, d] = householdDate.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const day = utc.getUTCDay();
  return day === 0 ? 7 : day;
}

export function addHouseholdDays(householdDate: HouseholdDate, days: number): HouseholdDate {
  const [y, m, d] = householdDate.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function compareHouseholdDates(a: HouseholdDate, b: HouseholdDate): number {
  return a.localeCompare(b);
}

export function nowUtcIso(): string {
  return new Date().toISOString();
}
