export interface StreakSession { started_at: string; ended_at: string | null; review: string | null }
export interface StreakViolation { occurred_at: string }
export type DayState = "ok" | "broken" | "none" | "pending";
export interface StreakResult { current: number; best: number; days: { date: string; state: DayState }[] }

/** YYYY-MM-DD of an instant in the given time zone. */
export function dayKey(d: Date | string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
}

function isWeekend(key: string) {
  const wd = new Date(`${key}T12:00:00Z`).getUTCDay();
  return wd === 0 || wd === 6;
}

function prevKey(key: string) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Discipline streak over market days (Mon–Fri).
 * ok = a session closed with a review and no violation that day.
 * broken = a violation, or a session left open/without review (past days only).
 * none = no session (weekday): neither breaks nor counts. Weekends are skipped.
 * Today stays "pending" until it becomes ok or gets a violation.
 */
export function disciplineStreak(sessions: StreakSession[], violations: StreakViolation[], tz: string, now = new Date(), lookback = 120): StreakResult {
  const today = dayKey(now, tz);
  const byDay = new Map<string, StreakSession[]>();
  for (const s of sessions) {
    const k = dayKey(s.started_at, tz);
    byDay.set(k, [...(byDay.get(k) ?? []), s]);
  }
  const violDays = new Set(violations.map((v) => dayKey(v.occurred_at, tz)));

  const stateOf = (k: string): DayState => {
    const ss = byDay.get(k) ?? [];
    if (violDays.has(k)) return "broken";
    if (ss.length === 0) return k === today ? "pending" : "none";
    const allClosed = ss.every((s) => s.ended_at && (s.review ?? "").trim());
    if (allClosed) return "ok";
    return k === today ? "pending" : "broken";
  };

  const chrono: { date: string; state: DayState }[] = [];
  let k = today;
  for (let i = 0; i < lookback; i++) {
    if (!isWeekend(k)) chrono.unshift({ date: k, state: stateOf(k) });
    k = prevKey(k);
  }

  let best = 0, run = 0;
  for (const d of chrono) {
    if (d.state === "ok") { run++; best = Math.max(best, run); }
    else if (d.state === "broken") run = 0;
  }
  return { current: run, best, days: chrono.slice(-10) };
}

/**
 * Login streak over market days (Mon–Fri): a day counts when Hadi opened the app
 * and had no violation. A past weekday without a visit, or with a violation, resets it.
 * Today stays "pending" until he visits. Weekends are skipped.
 */
export function loginStreak(visitDays: string[], violations: StreakViolation[], tz: string, now = new Date(), lookback = 120): StreakResult {
  const today = dayKey(now, tz);
  const visits = new Set(visitDays);
  const violDays = new Set(violations.map((v) => dayKey(v.occurred_at, tz)));
  const chrono: { date: string; state: DayState }[] = [];
  let k = today;
  for (let i = 0; i < lookback; i++) {
    if (!isWeekend(k)) {
      const state: DayState = violDays.has(k) ? "broken" : visits.has(k) ? "ok" : k === today ? "pending" : "broken";
      chrono.unshift({ date: k, state });
    }
    k = prevKey(k);
  }
  let best = 0, run = 0;
  for (const d of chrono) {
    if (d.state === "ok") { run++; best = Math.max(best, run); }
    else if (d.state === "broken") run = 0;
  }
  return { current: run, best, days: chrono.slice(-10) };
}
