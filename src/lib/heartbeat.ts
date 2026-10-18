/**
 * The app's one timer. Every visible minute it beats once ("tick": re-read trades, the bell,
 * run the risk watcher); hidden or offline it stays silent, and coming back after a real
 * absence beats at once ("resume": re-read everything on screen). Pure apart from
 * setTimeout, so the iPhone behaviour is unit-tested with fake timers.
 */
export const BEAT_MS = 60_000;

/** Away longer than this (MT5, the lock screen, no signal) and what's on screen counts as stale. */
export const RESUME_AFTER_MS = 15_000;

export type Beat = "tick" | "resume";

/**
 * Coming back: refresh at once when he was away more than 15s, or when his trading day
 * changed meanwhile (yesterday's P&L and limits must never greet a new day).
 */
export function shouldRefreshOnResume(awayMs: number, lastDay: string, today: string): boolean {
  return awayMs > RESUME_AFTER_MS || lastDay !== today;
}

export interface HeartbeatOptions {
  onBeat: (beat: Beat) => void;
  /** His calendar day now (trading-day.ts dayKey in his zone). */
  today: () => string;
  every?: number;
  now?: () => number;
}

export interface Heartbeat {
  /** Hidden or offline: no beats until back. */
  away(): void;
  /** On screen and online again (visibilitychange, pageshow, online); also starts it. */
  back(): void;
  stop(): void;
}

export function createHeartbeat({ onBeat, today, every = BEAT_MS, now = Date.now }: HeartbeatOptions): Heartbeat {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = now();
  let day = today();
  let awaySince: number | null = null;
  let stopped = false;

  function beat(kind: Beat) {
    last = now();
    day = today();
    onBeat(kind);
  }

  function schedule() {
    clearTimeout(timer);
    if (stopped || awaySince != null) return;
    // Counted from the last beat, so quick glances at another app never push the minute back.
    timer = setTimeout(() => {
      // Crossing his midnight on screen is a new day: refresh everything, not just the minute's data.
      beat(day !== today() ? "resume" : "tick");
      schedule();
    }, Math.max(0, last + every - now()));
  }

  return {
    away() {
      if (awaySince == null) awaySince = now();
      clearTimeout(timer);
    },
    back() {
      if (stopped) return;
      const since = awaySince;
      awaySince = null;
      if (since != null && shouldRefreshOnResume(now() - since, day, today())) beat("resume");
      schedule();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
