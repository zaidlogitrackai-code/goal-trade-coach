import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { currentUserId } from "@/lib/queries";
import { collapseToasts, deliveryOf, nextDaily, riskAlerts, type ToastLevel, type WatchTrade } from "@/lib/risk-watch";
import { applyPctLimits } from "@/lib/effective-limits";
import { loadCapital } from "@/lib/capital-store";
import { eveningReview } from "@/lib/ai.functions";
import { effectiveDailyTarget } from "@/lib/daily-plan";
import { dayKey, wallClock } from "@/lib/trading-day";

const EVERY_MS = 60_000;
export const RISK_THREAD = "حارس المخاطر";

const TOAST_ID = "risk-watch";

function pop(title: string, body: string, level: ToastLevel) {
  const fn = level === "danger" ? toast.error : level === "warning" ? toast.warning : level === "success" ? toast.success : toast.info;
  // One id: a later run replaces a toast still on screen instead of stacking under the header.
  fn(title, { id: TOAST_ID, description: body, duration: 6_000 });
  try {
    if ("Notification" in window && Notification.permission === "granted" && document.hidden) new Notification(title, { body });
  } catch { /* notifications unsupported */ }
}

/** Risk guardian: while the app is open, checks limits every minute and delivers due reminders. */
export function RiskWatcher() {
  const qc = useQueryClient();
  const review = useServerFn(eveningReview);
  useEffect(() => {
    let stop = false;
    // Each distinct failure toasts once per app session; it is still logged every minute.
    const shown = new Set<string>();
    async function tick() {
      try {
        const user_id = await currentUserId();
        const [s, t] = await Promise.all([
          supabase.from("trading_settings").select("*").maybeSingle(),
          supabase.from("trades").select("id,symbol,stop_loss,status,pnl,risk_amount,opened_at,closed_at").gte("opened_at", new Date(Date.now() - 35 * 86_400_000).toISOString()),
        ]);
        const tz = s.data?.timezone;
        const today = dayKey(new Date(), tz);
        const plan = await supabase.from("daily_plans").select("target").eq("day", today).maybeSingle();
        let added = false;
        const fresh: { title: string; body: string; level: ToastLevel }[] = [];
        // A failed insert must never pass silently: that is how risk alerts used to vanish.
        const failed = (what: string, e: { message: string }) => {
          console.error(`RiskWatcher: ${what}`, e);
          if (!shown.has(e.message)) {
            shown.add(e.message);
            toast.error("ما قدرت أوصل تنبيه", { id: `${TOAST_ID}-error`, description: e.message, duration: 6_000 });
          }
        };
        if (s.data && t.data) {
          const lim = applyPctLimits(s.data, (await loadCapital()).summary.balance);
          const alerts = riskAlerts({ ...lim, daily_target: effectiveDailyTarget(plan.data?.target, lim.daily_target) }, t.data as WatchTrade[]);
          if (alerts.length) {
            const { data: seen } = await supabase.from("notifications").select("dedupe_key").in("dedupe_key", alerts.map((a) => a.key));
            const known = new Set((seen ?? []).map((x) => x.dedupe_key));
            let threadId: string | null | undefined;
            for (const a of alerts.filter((x) => !known.has(x.key))) {
              const { error } = await supabase.from("notifications").insert({ user_id, kind: "risk", day: today, title: a.title, body: a.body, dedupe_key: a.key });
              const got = deliveryOf(error);
              if (got === "already") continue;
              if (got === "failed") { failed(a.title, error!); continue; }
              fresh.push(a); added = true;
              if (threadId === undefined) {
                const { data: th } = await supabase.from("coach_threads").select("id").or(`title.eq.${RISK_THREAD},title.like.${RISK_THREAD} · %`).order("updated_at", { ascending: false }).limit(1);
                threadId = th?.[0]?.id ?? null;
              }
              if (threadId) await supabase.from("coach_messages").insert({ user_id, thread_id: threadId, role: "assistant", content: `**${a.title}**\n\n${a.body}` });
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
          // Not delivered: keep next_at as is so the next minute tries again.
          if (got === "failed") { failed(title, error!); continue; }
          if (got === "new") { fresh.push({ title, body: r.body || r.title, level: "info" }); added = true; }
          const patch = r.repeat === "daily" && r.at_time ? { next_at: nextDaily(r.at_time.slice(0, 5), new Date(), tz).toISOString() } : { active: false };
          const { error: moved } = await supabase.from("reminders").update(patch).eq("id", r.id);
          // Harmless if it fails: the next run hits the same key, sees "already" and moves it then.
          if (moved) console.error("RiskWatcher: reminder not advanced", moved);
          else added = true;
        }
        const one = collapseToasts(fresh);
        if (one && !stop) pop(one.title, one.body, one.level);
        // Evening review once per day after 21:00.
        if (wallClock(new Date(), tz).hour >= 21) {
          const r = await review().catch(() => null);
          if (r?.created) added = true;
        }
        if (added && !stop) { qc.invalidateQueries({ queryKey: ["notifications"] }); qc.invalidateQueries({ queryKey: ["reminders"] }); }
      } catch { /* try again next minute */ }
    }
    void tick();
    const id = setInterval(() => { if (!document.hidden) void tick(); }, EVERY_MS);
    return () => { stop = true; clearInterval(id); };
  }, [qc, review]);
  return null;
}
