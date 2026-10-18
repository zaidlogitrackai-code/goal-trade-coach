import { useEffect, useRef } from "react";
import { useQueryClient, type InvalidateQueryFilters } from "@tanstack/react-query";
import { createHeartbeat, type Beat } from "@/lib/heartbeat";
import { dayKey } from "@/lib/trading-day";
import type { Settings } from "@/lib/queries";

const listeners = new Set<(beat: Beat) => void>();

/**
 * What each beat re-reads. A tick is the minute's moving parts: trades (a close entered on
 * another screen) and the bell (server-written messages). A resume is everything on screen,
 * because an iPhone home-screen app is frozen in the background and wakes up with whatever
 * it showed before MT5 took over. Only queries on screen refetch; the rest are marked stale.
 */
const TICK: InvalidateQueryFilters[] = [{ queryKey: ["trades"] }, { queryKey: ["notifications"], exact: true }];
const RESUME: InvalidateQueryFilters[] = [
  { queryKey: ["trades"] },
  { queryKey: ["settings"] },
  { queryKey: ["notifications"] },
  { queryKey: ["daily_plan"] },
  { queryKey: ["sessions"] },
  // The open thread: a reply that finished (keepAlive) while he was away.
  { queryKey: ["messages"] },
];

/**
 * The app's one clock (`src/lib/heartbeat.ts`), mounted once in the signed-in layout: it
 * re-reads data on every beat, then hands the beat to RiskWatcher and the open chat (useBeat).
 */
export function useHeartbeat() {
  const qc = useQueryClient();
  useEffect(() => {
    const hb = createHeartbeat({
      today: () => dayKey(new Date(), qc.getQueryData<Settings | null>(["settings"])?.timezone),
      onBeat: (beat) => {
        // Refetches start synchronously, so a listener's fetchQuery shares them instead of doubling.
        for (const f of beat === "resume" ? RESUME : TICK) void qc.invalidateQueries(f);
        for (const fn of listeners) fn(beat);
      },
    });
    // Offline counts as away: nothing to fetch, and coming back online is a resume.
    const sync = () => (document.visibilityState === "visible" && navigator.onLine !== false ? hb.back() : hb.away());
    const away = () => hb.away();
    sync();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("pageshow", sync);
    window.addEventListener("pagehide", away);
    window.addEventListener("online", sync);
    window.addEventListener("offline", away);
    return () => {
      hb.stop();
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pageshow", sync);
      window.removeEventListener("pagehide", away);
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", away);
    };
  }, [qc]);
}

/** Runs on every beat: "tick" each visible minute, "resume" on coming back or a new trading day. */
export function useBeat(fn: (beat: Beat) => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const listener = (beat: Beat) => ref.current(beat);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
}
