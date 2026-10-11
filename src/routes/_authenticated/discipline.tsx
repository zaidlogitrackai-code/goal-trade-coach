import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, Loading, PageHeader, Stat } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { currentUserId, settingsQuery, tradesQuery, violationsQuery } from "@/lib/queries";
import { disciplineReport } from "@/lib/stats";
import { countConsecutiveLosses } from "@/lib/trading-status";

export const Route = createFileRoute("/_authenticated/discipline")({
  head: () => ({ meta: [{ title: "الانضباط والطمع — نظام هادي" }, { name: "description", content: "يكشف سلوكك قبل لا يكلفك." }] }),
  component: DisciplinePage,
});

function DisciplinePage() {
  const qc = useQueryClient();
  const s = useQuery(settingsQuery);
  const t = useQuery(tradesQuery);
  const v = useQuery(violationsQuery);
  const [mins, setMins] = useState<number | "">("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  useEffect(() => { if (s.data && mins === "") setMins(s.data.cooldown_minutes); }, [s.data, mins]);
  if (s.isLoading || t.isLoading) return <Loading />;
  const trades = t.data ?? [];
  const rep = disciplineReport(trades, v.data ?? [], Number(s.data?.max_risk_per_trade) || 0);
  const until = s.data?.cooldown_until ? new Date(s.data.cooldown_until).getTime() : 0;
  const left = Math.max(0, until - now);
  const streak = countConsecutiveLosses(trades.map((x) => ({ status: x.status, pnl: x.pnl == null ? null : Number(x.pnl), opened_at: x.opened_at, closed_at: x.closed_at })) as never);
  const maxStreak = s.data?.max_consecutive_losses ?? 0;

  async function save(patch: { cooldown_until?: string | null; cooldown_minutes?: number }) {
    const user_id = await currentUserId();
    const { error } = await supabase.from("trading_settings").update(patch).eq("user_id", user_id);
    if (error) { toast.error("ما قدرت أحفظ"); return; }
    qc.invalidateQueries({ queryKey: ["settings"] });
  }
  const m = Number(mins) || 30;
  const fmt = (ms: number) => { const sec = Math.ceil(ms / 1000); return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`; };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="الانضباط والطمع" subtitle="يقيس التزامك من صفقاتك أنت، ويوقفك وقت ما تحتاج." />

      <div className="panel p-6">
        <h2 className="font-semibold">فترة التهدئة</h2>
        {left > 0 ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <div><p className="text-sm text-muted-foreground">التداول موقوف لين تخلص المدة</p><p className="font-data mt-1 text-4xl font-bold" dir="ltr">{fmt(left)}</p></div>
            <Button variant="secondary" onClick={() => save({ cooldown_until: null })}>إنهاء التهدئة الآن</Button>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="space-y-2"><Label>المدة بالدقائق</Label><Input type="number" min={1} className="w-32" value={mins} onChange={(e) => setMins(e.target.value === "" ? "" : Number(e.target.value))} /></div>
            <Button onClick={() => save({ cooldown_minutes: m, cooldown_until: new Date(Date.now() + m * 60000).toISOString() })}>ابدأ فترة تهدئة</Button>
            <Button variant="ghost" onClick={() => save({ cooldown_minutes: m }).then(() => toast.success("حُفظت المدة الافتراضية"))}>حفظ كمدة افتراضية</Button>
          </div>
        )}
        {maxStreak > 0 && streak >= maxStreak && left === 0 && (
          <p className="mt-4 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">وصلت {streak} خسائر متتالية (حدك {maxStreak}). ننصحك تبدأ فترة تهدئة الحين.</p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">أثناء التهدئة تظهر حالة اليوم "التداول متوقف" وتنبهك صفحة الصفقة الجديدة.</p>
      </div>

      {rep.score == null ? <EmptyState text="سجّل صفقات عشان نحسب درجة انضباطك." /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="درجة الانضباط" value={`${rep.score}/100`} tone={rep.score >= 75 ? "success" : rep.score < 50 ? "destructive" : undefined} />
            <Stat label="الالتزام بقائمة التحقق" value={`${Math.round(rep.checklistRate)}%`} />
            <Stat label="تجاوز المخاطرة" value={rep.overRisk} tone={rep.overRisk ? "destructive" : undefined} />
            <Stat label="تداول انتقامي" value={rep.revenge} tone={rep.revenge ? "destructive" : undefined} />
            <Stat label="صفقات بدافع الطمع" value={rep.greedy} tone={rep.greedy ? "destructive" : undefined} />
          </div>
          <div className="panel p-6">
            <h2 className="font-semibold">مؤشرات السلوك</h2>
            {rep.signals.length === 0 ? <p className="mt-3 text-sm text-success">ما فيه إشارات سلبية. استمر على نفس الانضباط.</p> : (
              <ul className="mt-3 space-y-2 text-sm">{rep.signals.map((x) => <li key={x} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-destructive" />{x}</li>)}</ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
