import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, Loading, PageHeader, Stat } from "@/components/app-shell";
import { Md } from "@/components/md";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { reportSummary } from "@/lib/ai.functions";
import { fmtDate, fmtMoney, settingsQuery, tradesQuery, violationsQuery } from "@/lib/queries";
import { groupPnl, tradeStats } from "@/lib/stats";
import { disciplineReport } from "@/lib/discipline";
import { REVENGE_WINDOW_MIN } from "@/lib/emotions";
import { addDays, dayKey, dayStart, zonedMidnight } from "@/lib/trading-day";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "التقارير — نظام هادي" }, { name: "description", content: "تقارير يومية وأسبوعية وشهرية من صفقاتك." }] }),
  component: ReportsPage,
});

type P = "day" | "week" | "month" | "custom";
const LABEL: Record<P, string> = { day: "اليوم", week: "آخر ٧ أيام", month: "آخر ٣٠ يوم", custom: "فترة مخصصة" };

function ReportsPage() {
  const t = useQuery(tradesQuery);
  const s = useQuery(settingsQuery);
  const v = useQuery(violationsQuery);
  const gen = useServerFn(reportSummary);
  const [p, setP] = useState<P>("week");
  // null = the last 7 days on the trader's calendar, filled once his zone is known.
  const [fromPick, setFrom] = useState<string | null>(null);
  const [toPick, setTo] = useState<string | null>(null);
  const [ai, setAi] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (t.isLoading) return <Loading />;
  const cur = s.data?.currency ?? "USD";

  const tz = s.data?.timezone;
  const to = toPick ?? dayKey(new Date(), tz);
  const from = fromPick ?? addDays(to, -6);
  const end = p === "custom" ? new Date(zonedMidnight(addDays(to, 1), tz).getTime() - 1) : new Date();
  const start = p === "custom" ? zonedMidnight(from, tz) : p === "day" ? dayStart(new Date(), tz) : new Date(Date.now() - (p === "week" ? 7 : 30) * 864e5);
  const inRange = (d: string) => { const x = new Date(d).getTime(); return x >= start.getTime() && x <= end.getTime(); };
  const trades = (t.data ?? []).filter((x) => inRange(x.opened_at));
  const viol = (v.data ?? []).filter((x) => inRange(x.occurred_at));
  const k = tradeStats(trades);
  const d = disciplineReport(t.data ?? [], v.data ?? [], {
    maxRiskPerTrade: Number(s.data?.max_risk_per_trade) || 0,
    tz,
    revengeWindowMin: REVENGE_WINDOW_MIN(s.data),
    range: { start, end },
  });
  const bySym = groupPnl(trades, (x) => x.symbol);

  async function runAi() {
    setBusy(true); setAi(null);
    try {
      // Today's nudges are not part of a period's report.
      const discipline = { score: d.score, sample: d.sample, concerns: d.concerns, strengths: d.strengths, metrics: d.metrics };
      const stats = JSON.stringify({ ...k, profitFactor: Number.isFinite(k.profitFactor) ? k.profitFactor : "لا خسائر", discipline, bySymbol: bySym, violations: viol.length });
      const r = await gen({ data: { period: LABEL[p], stats } });
      setAi(r.text);
    } catch (e) { toast.error(e instanceof Error ? e.message : "تعذّر إنشاء التقرير"); }
    finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="التقارير" subtitle={`من ${fmtDate(start.toISOString())} إلى ${fmtDate(end.toISOString())}`} action={<Button variant="secondary" onClick={() => window.print()}>طباعة / PDF</Button>} />
      <div className="flex flex-wrap items-end gap-2">
        {(Object.keys(LABEL) as P[]).map((x) => <Button key={x} size="sm" variant={p === x ? "default" : "secondary"} onClick={() => { setP(x); setAi(null); }}>{LABEL[x]}</Button>)}
        {p === "custom" && (<>
          <div className="space-y-1"><Label className="text-xs">من</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">إلى</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </>)}
      </div>
      {trades.length === 0 ? <EmptyState text="ما فيه صفقات في هذه الفترة." /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="عدد الصفقات" value={k.total} />
            <Stat label="صافي الربح" value={fmtMoney(k.netPnl, cur)} tone={k.netPnl >= 0 ? "success" : "destructive"} />
            <Stat label="نسبة الفوز" value={`${k.winRate.toFixed(1)}%`} />
            <Stat label="درجة الانضباط" value={d.score == null ? "—" : `${d.score}/100`} />
            <Stat label="مفتوحة" value={k.open} />
            <Stat label="مخالفات" value={viol.length} tone={viol.length ? "destructive" : undefined} />
            <Stat label="أفضل صفقة" value={fmtMoney(k.best, cur)} />
            <Stat label="أسوأ صفقة" value={fmtMoney(k.worst, cur)} />
          </div>
          <div className="panel p-5">
            <h2 className="mb-3 font-semibold">النتائج حسب الأصل</h2>
            {bySym.length === 0 ? <p className="text-sm text-muted-foreground">لا توجد صفقات مغلقة.</p> : bySym.map((g) => (
              <div key={g.name} className="flex justify-between border-b border-border py-2 text-sm last:border-0"><span dir="ltr">{g.name} ({g.count})</span><span className={`font-data ${g.pnl >= 0 ? "text-success" : "text-destructive"}`} dir="ltr">{fmtMoney(g.pnl, cur)}</span></div>
            ))}
          </div>
          <div className="panel p-5">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">تقرير سَنَد</h2><Button onClick={runAi} disabled={busy}>{busy ? "يكتب التقرير…" : "اكتب لي التقرير"}</Button></div>
            {ai ? <div className="mt-4"><Md>{ai}</Md></div> : <p className="mt-3 text-sm text-muted-foreground">يحلل أرقام هذه الفترة ويعطيك نقاط قوة وأخطاء وخطوات عملية.</p>}
          </div>
        </>
      )}
    </div>
  );
}
