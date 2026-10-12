import { useQuery } from "@tanstack/react-query";
import { Flame } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { settingsQuery, violationsQuery } from "@/lib/queries";
import { disciplineStreak, type DayState } from "@/lib/streak";

const DOT: Record<DayState, string> = { ok: "bg-success", broken: "bg-destructive", none: "bg-muted", pending: "border border-foreground/40" };

export function StreakCard({ large = false, compact = false }: { large?: boolean; compact?: boolean }) {
  const s = useQuery(settingsQuery);
  const v = useQuery(violationsQuery);
  const sess = useQuery({
    queryKey: ["sessions", "streak"],
    queryFn: async () => {
      const { data, error } = await supabase.from("trading_sessions").select("started_at,ended_at,review").gte("started_at", new Date(Date.now() - 180 * 864e5).toISOString());
      if (error) throw error;
      return data;
    },
  });
  if (!sess.data || !v.data) return null;
  const r = disciplineStreak(sess.data, v.data, s.data?.timezone || "Asia/Riyadh");
  if (compact) return (
    <section className="glass grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-full px-3 py-1.5" aria-label="ستريك الانضباط">
      <p className="flex min-w-0 items-center gap-1.5 truncate text-xs">
        <Flame className={`size-3.5 shrink-0 ${r.current > 0 ? "text-warning" : "text-muted-foreground"}`} />
        <span className="font-data font-semibold tabular-nums">{r.current}</span> {r.current === 1 ? "يوم" : "أيام"} انضباط
        <span className="text-muted-foreground">· أفضل {r.best}</span>
      </p>
      <div className="flex shrink-0 gap-1" dir="ltr">
        {r.days.map((d) => <span key={d.date} title={d.date} className={`size-1.5 rounded-full ${DOT[d.state]}`} />)}
      </div>
    </section>
  );
  return (
    <section className={`panel grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 ${large ? "p-5 sm:p-6" : "p-4"}`}>
      <div className="flex min-w-0 items-center gap-3">
        <div className={`grid shrink-0 place-items-center rounded-full ${r.current > 0 ? "bg-warning/15 text-warning" : "bg-muted/50 text-muted-foreground"} ${large ? "size-12" : "size-10"}`}>
          <Flame className={large ? "size-6" : "size-5"} />
        </div>
        <div className="min-w-0">
          <p className={`font-display font-semibold ${large ? "text-2xl" : "text-lg"}`}>
            <span className="font-data tabular-nums">{r.current}</span> {r.current === 1 ? "يوم" : "أيام"} انضباط
          </p>
          <p className="truncate text-xs text-muted-foreground">أفضل ستريك: {r.best} · السبت والأحد ما ينحسبون</p>
        </div>
      </div>
      <div className="flex shrink-0 gap-1" dir="ltr" aria-label="آخر 10 أيام سوق">
        {r.days.map((d) => <span key={d.date} title={d.date} className={`size-2.5 rounded-full ${DOT[d.state]}`} />)}
      </div>
    </section>
  );
}
