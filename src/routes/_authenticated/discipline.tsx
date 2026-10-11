import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, Loading, PageHeader, Stat } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { currentUserId, fmtMoney, settingsQuery, tradesQuery, violationsQuery } from "@/lib/queries";
import { disciplineReport, scoreSummary, WINDOW_DAYS } from "@/lib/discipline";
import { countConsecutiveLosses, startOfToday } from "@/lib/trading-status";

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
  if (s.isLoading || t.isLoading || v.isLoading) return <Loading />;
  const trades = t.data ?? [];
  const rep = disciplineReport(trades, v.data ?? [], { maxRiskPerTrade: Number(s.data?.max_risk_per_trade) || 0 });
  const summary = scoreSummary(rep);
  const mt = rep.metrics;
  const rate = (x: number | null) => (x == null ? "غير متاح" : `${Math.round(x)}%`);
  const until = s.data?.cooldown_until ? new Date(s.data.cooldown_until).getTime() : 0;
  const left = Math.max(0, until - now);
  // Today's streak only (same rule as the trade gate).
  const todayStart = startOfToday().getTime();
  const streak = countConsecutiveLosses(trades.filter((x) => x.closed_at && new Date(x.closed_at).getTime() >= todayStart));
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

      {rep.interventions.length > 0 && (
        <div className="panel space-y-3 border-warning/50 p-6" role="status">
          <h2 className="font-semibold">تنبيهات اليوم</h2>
          {rep.interventions.map((x) => (
            <div key={x.kind} className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <p>{x.message}</p>
              {x.kind === "cooldown" && left === 0 && (
                <Button size="sm" onClick={() => save({ cooldown_minutes: m, cooldown_until: new Date(Date.now() + m * 60000).toISOString() })}>ابدأ تهدئة {m} دقيقة</Button>
              )}
              {x.kind === "review" && <Button asChild size="sm" variant="secondary"><Link to="/trades">راجع الصفقة</Link></Button>}
            </div>
          ))}
        </div>
      )}

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
          <p className="mt-4 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">وصلت {streak} خسائر متتالية اليوم (حدك {maxStreak}). ننصحك تبدأ فترة تهدئة الحين.</p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">أثناء التهدئة تظهر حالة اليوم "التداول متوقف" وتنبهك صفحة الصفقة الجديدة.</p>
      </div>

      {rep.score == null ? (
        <div className="panel space-y-4 p-6">
          <EmptyState text={`لا توجد صفقات في آخر ${WINDOW_DAYS} يومًا لحساب درجة الانضباط.`} />
          <p className="text-sm text-muted-foreground">
            الدرجة تُحسب من صفقاتك أنت فقط: وقف الخسارة، قائمة التحقق، الدخول بعد خسارة، تجاوز المخاطرة، الطمع، والمخالفات. وتظهر معها الأسباب، لا الرقم وحده.
          </p>
          <div className="rounded-lg border border-dashed p-4 text-sm">
            <p className="mb-2 text-xs font-medium text-muted-foreground">مثال توضيحي — ليس من بياناتك</p>
            <p className="font-semibold">درجة الانضباط: 72/100</p>
            <p className="mt-1">السبب: حددت وقف الخسارة في 8 من 10 صفقات، لكن: دخلت مرتين خلال 5 دقائق بعد خسارة.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="panel p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">درجة الانضباط</h2>
              <span className="text-xs text-muted-foreground">آخر {WINDOW_DAYS} يومًا · {rep.sample} صفقة</span>
            </div>
            <p className={`font-data mt-2 text-4xl font-bold ${rep.score >= 75 ? "text-success" : rep.score < 50 ? "text-destructive" : "text-warning"}`} dir="ltr" style={{ textAlign: "right" }}>{rep.score}/100</p>
            {summary && <p className="mt-2 text-sm">السبب: {summary}</p>}
            <ul className="mt-4 space-y-2 text-sm">
              {rep.concerns.map((x) => <li key={x} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-destructive" />{x}</li>)}
              {rep.strengths.map((x) => <li key={x} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-success" />{x}</li>)}
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="الالتزام بقائمة التحقق" value={rate(mt.planAdherenceRate)} />
            <Stat label="تحديد وقف الخسارة" value={rate(mt.stopLossSetRate)} />
            <Stat label="خسائر ضمن المخاطرة المخططة" value={rate(mt.lossWithinRiskRate)} />
            <Stat label="مخالفات القواعد" value={mt.violations} tone={mt.violations ? "destructive" : undefined} />
            <Stat label="دخول خلال 15 دقيقة بعد خسارة" value={mt.revengeCount} tone={mt.revengeCount ? "destructive" : undefined} />
            <Stat label="صفقات بدافع الطمع" value={mt.greedCount} tone={mt.greedCount ? "destructive" : undefined} />
            <Stat label="متوسط الوقت بين الصفقات" value={mt.avgMinutesBetweenTrades == null ? "غير متاح" : `${mt.avgMinutesBetweenTrades} د`} />
            <Stat label="صفقات بعد خسارتين متتاليتين" value={mt.tradesAfterTwoLosses} tone={mt.tradesAfterTwoLosses ? "destructive" : undefined} />
          </div>

          <div className="panel overflow-x-auto p-6">
            <h2 className="mb-3 font-semibold">الحالة النفسية مقابل النتيجة</h2>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr><th className="pb-2 text-start font-normal">الحالة</th><th className="pb-2 text-start font-normal">الصفقات</th><th className="pb-2 text-start font-normal">نسبة الربح</th><th className="pb-2 text-start font-normal">صافي النتيجة</th></tr>
              </thead>
              <tbody>
                {rep.emotionVsResult.map((r) => (
                  <tr key={r.emotion} className="border-t border-border/50">
                    <td className="py-2">{r.emotion}</td>
                    <td className="font-data py-2">{r.count}</td>
                    <td className="font-data py-2">{r.winRate == null ? "—" : `${Math.round(r.winRate)}%`}</td>
                    <td className={`font-data py-2 ${r.pnl > 0 ? "text-success" : r.pnl < 0 ? "text-destructive" : ""}`} dir="ltr" style={{ textAlign: "right" }}>{fmtMoney(r.pnl, s.data?.currency ?? "USD")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted-foreground">نسبة الربح من الصفقات المغلقة فقط. عدد قليل من الصفقات لا يكفي لاستنتاج نمط.</p>
          </div>
        </>
      )}
    </div>
  );
}
