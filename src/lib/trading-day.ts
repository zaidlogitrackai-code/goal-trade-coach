/**
 * The trader's calendar. Every "today / this week / this month" boundary comes from
 * here, in trading_settings.timezone, never in the device's or the server's own zone
 * (the server runs in UTC, so its midnight is 03:00 in Riyadh).
 */
export const DEFAULT_TZ = "Asia/Riyadh";

type Instant = Date | string | number;

const formats = new Map<string, Intl.DateTimeFormat>();
function format(tz: string) {
  let f = formats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formats.set(tz, f);
  }
  return f;
}

/** A usable IANA zone: empty or unknown values fall back to Asia/Riyadh, so a bad saved value never crashes a page. */
export function safeTz(tz?: string | null): string {
  if (!tz) return DEFAULT_TZ;
  try {
    format(tz);
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

/** Wall-clock fields of an instant in the zone. */
export function wallClock(d: Instant, tz: string | null | undefined) {
  const p: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const x of format(safeTz(tz)).formatToParts(new Date(d))) if (x.type !== "literal") p[x.type] = Number(x.value);
  return { year: p.year!, month: p.month!, day: p.day!, hour: (p.hour ?? 0) % 24, minute: p.minute ?? 0, second: p.second ?? 0 };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD of an instant in the zone. */
export function dayKey(d: Instant, tz: string | null | undefined): string {
  const w = wallClock(d, tz);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** Calendar arithmetic on YYYY-MM-DD keys (no zone involved). A malformed key passes through. */
export function addDays(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return key;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function offsetAt(t: number, tz: string) {
  const w = wallClock(t, tz);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(t / 1000) * 1000;
}

/**
 * The instant a wall-clock time on a calendar day happens in the zone (DST-safe);
 * Invalid Date for a malformed key, like new Date(""). A time skipped by a DST jump
 * resolves to the moment the clock jumps to.
 */
export function zonedTime(key: string, hour: number, minute: number, tz: string | null | undefined): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return new Date(NaN);
  const z = safeTz(tz);
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, hour, minute);
  const a = wall - offsetAt(wall, z);
  const b = wall - offsetAt(a, z);
  // Across a DST change one guess can land an hour off; keep the guesses that read back as the wanted time.
  const exact = [a, b].filter((t) => {
    const w = wallClock(t, z);
    return dayKey(t, z) === key && w.hour === hour && w.minute === minute;
  });
  return new Date(exact.length ? Math.min(...exact) : Math.max(a, b));
}

/** The instant a calendar day starts in the zone. */
export function zonedMidnight(key: string, tz: string | null | undefined): Date {
  return zonedTime(key, 0, 0, tz);
}

/** Saturday or Sunday: the markets the app covers trade Mon–Fri. */
export function isWeekendDay(key: string): boolean {
  const wd = new Date(`${key}T12:00:00Z`).getUTCDay();
  return wd === 0 || wd === 6;
}

export function dayStart(now: Instant, tz: string | null | undefined): Date {
  return zonedMidnight(dayKey(now, tz), tz);
}

/** Monday 00:00: the trading week runs Mon–Fri. */
export function weekStart(now: Instant, tz: string | null | undefined): Date {
  const k = dayKey(now, tz);
  const fromMonday = (new Date(`${k}T12:00:00Z`).getUTCDay() + 6) % 7;
  return zonedMidnight(addDays(k, -fromMonday), tz);
}

export function monthStart(now: Instant, tz: string | null | undefined): Date {
  return zonedMidnight(`${monthKey(now, tz)}-01`, tz);
}

/** 00:00 of the next Mon–Fri day: Friday evening, Saturday and Sunday all lead to Monday. */
export function nextTradingDayStart(now: Instant, tz: string | null | undefined): Date {
  let k = addDays(dayKey(now, tz), 1);
  while (isWeekendDay(k)) k = addDays(k, 1);
  return zonedMidnight(k, tz);
}

/** ISO-8601 week of the trader's day, e.g. "2026-W42" (weeks start Monday; week 1 holds the first Thursday). */
export function isoWeekKey(now: Instant, tz: string | null | undefined): string {
  const d = new Date(`${dayKey(now, tz)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)); // that week's Thursday decides the year
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${pad(week)}`;
}

/** YYYY-MM of the trader's day. */
export function monthKey(now: Instant, tz: string | null | undefined): string {
  return dayKey(now, tz).slice(0, 7);
}

/** Value for <input type="datetime-local"> showing an instant on the trader's clock. */
export function toWallInput(d: Instant, tz: string | null | undefined): string {
  const w = wallClock(d, tz);
  return `${dayKey(d, tz)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/** Reads a datetime-local value as the trader's clock; null when empty or malformed. */
export function fromWallInput(s: string | null | undefined, tz: string | null | undefined): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(s ?? "");
  if (!m) return null;
  const d = zonedTime(m[1]!, Number(m[2]), Number(m[3]), tz);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** IANA zones for the settings picker, always including the given ones (a saved alias, the device zone). */
export function zoneList(...include: (string | null | undefined)[]): string[] {
  let all: string[] = [];
  try {
    all = Intl.supportedValuesOf("timeZone");
  } catch { /* older Safari: only the given zones */ }
  const extra = [DEFAULT_TZ, ...include].filter((z): z is string => !!z && safeTz(z) === z);
  return [...new Set([...all, ...extra])].sort();
}
