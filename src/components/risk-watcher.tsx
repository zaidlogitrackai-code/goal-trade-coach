import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { currentUserId } from "@/lib/queries";
import { nextDaily, riskAlerts, type WatchTrade } from "@/lib/risk-watch";
import { eveningReview } from "@/lib/ai.functions";

const EVERY_MS = 60_000;
export const RISK_THREAD = "حارس المخاطر";

function pop(title: string, body: string, level: "danger" | "warning" | "success" | "info") {
  const fn = level === "danger" ? toast.error : level === "warning" ? toast.warning : level === "success" ? toast.success : toast.info;
  fn(title, { description: body, duration: 12_000 });
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
    async function tick() {
      try {
        const user_id = await currentUserId();
        const [s, t] = await Promise.all([
          supabase.from("trading_settings").select("*").maybeSingle(),
          supabase.from("trades").select("id,symbol,stop_loss,status,pnl,risk_amount,opened_at,closed_at").gte("opened_at", new Date(Date.now() - 35 * 86_400_000).toISOString()),
        ]);
        let added = false;
        if (s.data && t.data) {
          const alerts = riskAlerts(s.data, t.data as WatchTrade[]);
          if (alerts.length) {
            const { data: seen } = await supabase.from("notifications").select("dedupe_key").in("dedupe_key", alerts.map((a) => a.key));
            const known = new Set((seen ?? []).map((x) => x.dedupe_key));
            for (const a of alerts.filter((x) => !known.has(x.key))) {
              const { error } = await supabase.from("notifications").insert({ user_id, kind: "risk", day: new Date().toISOString().slice(0, 10), title: a.title, body: a.body, dedupe_key: a.key });
              if (!error) {
                pop(a.title, a.body, a.level); added = true;
                const { data: th } = await supabase.from("coach_threads").select("id").eq("title", RISK_THREAD).limit(1);
                if (th?.[0]) await supabase.from("coach_messages").insert({ user_id, thread_id: th[0].id, role: "assistant", content: `**${a.title}**\n\n${a.body}` });
              }
            }
          }
        }
        // Reminders the trader asked the agents for.
        const { data: due } = await supabase.from("reminders").select("*").eq("active", true).lte("next_at", new Date().toISOString());
        for (const r of due ?? []) {
          const key = `rem:${r.id}:${r.next_at}`;
          const { error } = await supabase.from("notifications").insert({ user_id, kind: "reminder", day: new Date().toISOString().slice(0, 10), title: `⏰ ${r.title}`, body: r.body || r.title, dedupe_key: key });
          if (!error) { pop(`⏰ ${r.title}`, r.body, "info"); added = true; }
          const patch = r.repeat === "daily" && r.at_time ? { next_at: nextDaily(r.at_time.slice(0, 5)).toISOString() } : { active: false };
          await supabase.from("reminders").update(patch).eq("id", r.id);
        }
        // Evening review once per day after 21:00.
        if (new Date().getHours() >= 21) {
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
