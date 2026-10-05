// <input type="datetime-local"> speaks wall-clock time with no zone ("2026-10-05T09:30"). The
// schedule is stored as an instant, and the wall clock that matters is the editorial one, not
// the server's (UTC on the VPS) nor the browser's. So the string is taken apart by hand and never
// handed to new Date(): that would read it in whatever zone the process happens to run in.

export const DEFAULT_TZ = "America/Sao_Paulo";

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

// Throws RangeError on an unknown zone: that is a configuration mistake, not bad input.
function formatterFor(tz: string): Intl.DateTimeFormat {
  let formatter = formatters.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, formatter);
  }
  return formatter;
}

// The wall clock of `ms` in `tz`, expressed as if those digits were UTC.
function wallClock(ms: number, tz: string): number {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(tz).formatToParts(ms)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return Date.UTC(
    parts.year as number,
    (parts.month as number) - 1,
    parts.day as number,
    parts.hour as number,
    parts.minute as number,
    parts.second as number,
  );
}

function offsetAt(ms: number, tz: string): number {
  return wallClock(ms, tz) - Math.floor(ms / 1000) * 1000;
}

// Date.UTC rolls 02-30 over into March and 24:00 into the next day; this returns null instead.
function utcFromFields(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number | null {
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const back = new Date(ms);
  const same =
    back.getUTCFullYear() === year &&
    back.getUTCMonth() === month - 1 &&
    back.getUTCDate() === day &&
    back.getUTCHours() === hour &&
    back.getUTCMinutes() === minute &&
    back.getUTCSeconds() === second;
  return same ? ms : null;
}

// null when the value is not a datetime-local string, is not a real date, or names a wall-clock
// time that does not exist in the zone (the hour skipped when daylight saving starts). A time
// that happens twice (when it ends) resolves to the first occurrence.
export function localToIso(local: string, tz: string = DEFAULT_TZ): string | null {
  formatterFor(tz);
  const match = LOCAL_RE.exec(local);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map((v) => Number(v ?? 0)) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  const wall = utcFromFields(year, month, day, hour, minute, second);
  if (wall === null) return null;

  // The offsets in force a day before and a day after bracket any transition near this time.
  const candidates = [offsetAt(wall - DAY_MS, tz), offsetAt(wall + DAY_MS, tz)]
    .map((offset) => wall - offset)
    .filter((instant) => wallClock(instant, tz) === wall);
  if (candidates.length === 0) return null;
  return new Date(Math.min(...candidates)).toISOString();
}

const INSTANT_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

// A string never reaches new Date(): that reads a bare date as UTC midnight, a zone-less datetime
// in the machine's zone, and (depending on the engine) rolls 02-30 over into March. The fields
// are checked against the calendar here, and the zone (Z or an offset) is mandatory.
function parseInstant(instant: string): number | null {
  const match = INSTANT_RE.exec(instant);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map((v) => Number(v ?? 0)) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const wall = utcFromFields(year, month, day, hour, minute, second);
  if (wall === null) return null;
  if (!match[7]) return wall;

  const offsetHours = Number(match[8]);
  const offsetMinutes = Number(match[9]);
  if (offsetHours > 23 || offsetMinutes > 59) return null;
  const offset = (offsetHours * 60 + offsetMinutes) * 60_000;
  return match[7] === "+" ? wall - offset : wall + offset;
}

// The value for a datetime-local input: minutes precision, seconds dropped.
export function isoToLocal(instant: string | Date, tz: string = DEFAULT_TZ): string {
  const ms = typeof instant === "string" ? parseInstant(instant) : instant.getTime();
  if (ms === null || Number.isNaN(ms)) throw new RangeError("invalid instant");
  return new Date(wallClock(ms, tz)).toISOString().slice(0, 16);
}
