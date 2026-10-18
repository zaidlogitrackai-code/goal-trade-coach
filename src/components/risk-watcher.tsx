import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { currentUserId, settingsQuery, todayPlanQuery, tradesQuery } from "@/lib/queries";
import { collapseToasts, deliveryOf, nextDaily, riskAlerts, type ToastLevel, type WatchTrade } from "@/lib/risk-watch";
import { eveningReview } from "@/lib/ai.functions";
import { effectiveDailyTarget } from "@/lib/daily-plan";
import { dayKey, wallClock } from "@/lib/trading-day";
import { useBeat } from "@/hooks/use-resume";

export const RISK_THREAD = "حارس المخاطر";

/**
 * Settings (limits already in dollars of the live balance) and today's plan are re-read by
 * whatever writes them, by the heartbeat's resume and when trades change, so the watcher takes
 * them from the cache instead of four more requests a minute. Trades are re-read every tick.
 */
const FROM_CACHE = { staleTime: Infinity } as const;

const TOAST_ID = "risk-watch";

function pop(title: string, body: string, level: ToastLevel) {
  const fn = level === "danger" ? toast.error : level === "warning" ? toast.warning : level === "success" ? toast.success : toast.info;
  // One id: a later run replaces a toast still on screen instead of stacking under the header.
  fn(title, { id: TOAST_ID, description: body, duration: 6_000 });
  try {
    if ("Notification" in window && Notification.permission === "granted" && document.hidden) new Notification(title, { body });
  } catch { /* notifications unsupported */ }
}

/**
 * Risk guardian: on every heartbeat beat (each visible minute, and at once when he comes back)
 * checks his limits and delivers due reminders. Mounted once, in AppShell.
 */
export function RiskWatcher() {
  const qc = useQueryClient();
  const review = useServerFn(eveningReview);
  // Each distinct failure toasts once per app session; it is still logged on every run.
  const shown = useRef(new Set<string>());
  const running = useRef(false);
  const again = useRef(false);
  const alive = useRef(true);
  // The evening review answered for this day (created or already there): stop asking.
  const reviewed = useRef<string | null>(null);
  // Alert keys known to be in the bell. Rows are never deleted (only hidden), so a delivered
  // alert that is still true needn't be looked up again every minute.
  const delivered = useRef(new Set<string>());

  async function watch() {
    const user_id = await currentUserId();
    const [s, trades] = await Promise.all([qc.fetchQuery({ ...settingsQuery, ...FROM_CACHE }), qc.fetchQuery(tradesQuery)]);
    const tz = s?.timezone;
    const today = dayKey(new Date(), tz);
    let added = false;
    const fresh: { title: string; body: string; level: ToastLevel }[] = [];
    // A failed insert must never pass silently: that is how risk alerts used to vanish.
    const failed = (what: string, e: { message: string }) => {
      console.error(`RiskWatcher: ${what}`, e);
      if (!shown.current.has(e.message)) {
        shown.current.add(e.message);
        toast.error("ما قدرت أوصل تنبيه", { id: `${TOAST_ID}-error`, description: e.message, duration: 6_000 });
      }
    };
    if (s) {
      const plan = await qc.fetchQuery({ ...todayPlanQuery(tz), ...FROM_CACHE });
      const alerts = riskAlerts({ ...s, daily_target: effectiveDailyTarget(plan?.target, s.daily_target) }, trades as WatchTrade[]);
      const open = alerts.filter((a) => !delivered.current.has(a.key));
      if (open.length) {
        const { data: seen } = await supabase.from("notifications").select("dedupe_key").in("dedupe_key", open.map((a) => a.key));
        const known = new Set((seen ?? []).map((x) => x.dedupe_key));
        for (const k of known) if (k) delivered.current.add(k);
        let threadId: string | null | undefined;
        for (const a of open.filter((x) => !known.has(x.key))) {
          const { error } = await supabase.from("notifications").insert({ user_id, kind: "risk", day: today, title: a.title, body: a.body, dedupe_key: a.key });
          const got = deliveryOf(error);
          if (got === "failed") { failed(a.title, error!); continue; }
          delivered.current.add(a.key);
          if (got === "already") continue;
          fresh.push(a); added = true;
          if (threadId === undefined) {
            const { data: th } = await supabase.from("coach_threads").select("id").or(`title.eq.${RISK_THREAD},title.like.${RISK_THREAD} · %`).order("updated_at", { ascending: false }).limit(1);
            threadId = th?.[0]?.id ?? null;
          }
          if (threadId) {
            await supabase.from("coach_messages").insert({ user_id, thread_id: threadId, role: "assistant", content: `**${a.title}**\n\n${a.body}` });
            // The risk chat shows it now, not on the next beat.
            void qc.invalidateQueries({ queryKey: ["messages", threadId] });
          }
        }
      }
    }
    // Reminders the trader asked the agents for.
    const { data: due } = await supabase.from("reminders").select("*").eq("active", true).lte("next_at", new Date().toISOString());
    for (const r of due ?? []) {
      const key = `rem:${r.id}:${r.next_at}`;
      const title = `⏰ ${r.title}`;
      const { error } = await supabase.from("notifications").insert({ user_id, kind: "reminder", day: today, title, body: r.body || r.title, dedupe_key: key });
      const got = deliveryOf(error);
      // Not delivered: keep next_at as is so the next beat tries again.
      if (got === "failed") { failed(title, error!); continue; }
      if (got === "new") { fresh.push({ title, body: r.body || r.title, level: "info" }); added = true; }
      const patch = r.repeat === "daily" && r.at_time ? { next_at: nextDaily(r.at_time.slice(0, 5), new Date(), tz).toISOString() } : { active: false };
      const { error: moved } = await supabase.from("reminders").update(patch).eq("id", r.id);
      // Harmless if it fails: the next run hits the same key, sees "already" and moves it then.
      if (moved) console.error("RiskWatcher: reminder not advanced", moved);
      else added = true;
    }
    const one = collapseToasts(fresh);
    if (one && alive.current) pop(one.title, one.body, one.level);
    // Evening review once per day after 21:00.
    if (reviewed.current !== today && wallClock(new Date(), tz).hour >= 21) {
      const r = await review().catch(() => null);
      if (r) reviewed.current = today;
      if (r?.created) added = true;
    }
    if (added && alive.current) { void qc.invalidateQueries({ queryKey: ["notifications"] }); void qc.invalidateQueries({ queryKey: ["reminders"] }); }
  }

  // One run at a time; a beat that lands mid-run (a resume right after a tick) runs once more after it.
  async function run() {
    if (running.current) { again.current = true; return; }
    running.current = true;
    try {
      do {
        again.current = false;
        try { await watch(); } catch (e) { console.warn("RiskWatcher: run failed, the next beat tries again", e); }
      } while (again.current && alive.current);
    } finally {
      running.current = false;
    }
  }
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    alive.current = true;
    void runRef.current();
    return () => { alive.current = false; };
  }, []);
  useBeat(() => void run());
  return null;
}
