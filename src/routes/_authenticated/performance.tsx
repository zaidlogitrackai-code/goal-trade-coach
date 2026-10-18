import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { EmptyState, Loading, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { OpenTrades } from "@/components/dashboard/open-trades";
import { Breakdown, CoachInsight, EquityChart, Goals, Kpi, PnlCalendar } from "@/components/performance/widgets";
import { fmtMoney, settingsQuery, strategiesQuery, tradesQuery } from "@/lib/queries";
import { equityCurve, groupPnl, tradeStats } from "@/lib/stats";
import { safeTz } from "@/lib/trading-day";
import { avgHold, avgR, dailyPnl, delta, expectancy, hourBucket, inRange, maxDrawdown, periodRange, sideSplit, streaks, weekdayName, type Period } from "@/lib/perf";

const PERIODS: { id: Period; label: string }[] = [
  { id: "today", label: "اليوم" }, { id: "week", label: "الأسبوع" }, { id: "month", label: "الشهر" }, { id: "all", label: "الكل" },
];

export const Route = createFileRoute("/_authenticated/performance")({
  validateSearch: z.object({ period: z.enum(["today", "week", "month", "all"]).catch("all") }),
  head: () => ({ meta: [
    { title: "الأداء — نظام هادي" },
    { name: "description", content: "لوحة أداء احترافية من صفقاتك الحقيقية." },
    { property: "og:title", content: "الأداء — نظام هادي" },
    { property: "og:description", content: "لوحة أداء احترافية من صفقاتك الحقيقية." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: PerformancePage,
});

function PerformancePage() {
  const { period } = Route.useSearch();
  const nav = useNavigate({ from: "/performance" });
  const t = useQuery(tradesQuery);
  const s = useQuery(settingsQuery);
  const st = useQuery(strategiesQuery);
  if (t.isLoading) return <Loading />;
  const all = t.data ?? [];
  const cur = s.data?.currency ?? "USD";
  const tz = safeTz(s.data?.timezone);
  const startBal = Number(s.data?.starting_balance) || 0;

  if (all.length === 0) return (
    <div className="mx-auto max-w-5xl"><PageHeader title="الأداء" /><EmptyState title="لا توجد بيانات بعد" text="سجّل أول صفقة عن طريق المدرب وتبدأ لوحة الأداء تشتغل." action={<Button asChild><Link to="/coach">كلّم المدرب</Link></Button>} /></div>
  );

  const now = new Date();
  const range = periodRange(period, now, tz);
  const trades = range ? inRange(all, range.start, range.end) : all;
  const prev = range ? inRange(all, range.prevStart, range.start) : [];
  const k = tradeStats(trades), kp = tradeStats(prev);
  const has = k.closed > 0;
  const d = (v: string) => (has ? v : "—");

  // Balance before the window, so the curve shows real account level.
  const before = range ? all.filter((x) => x.status === "closed" && +new Date(x.closed_at ?? x.opened_at) < range.start).reduce((a, x) => a + (Number(x.pnl) || 0), 0) : 0;
  const curve = equityCurve(trades, startBal + before);
  const dd = maxDrawdown(trades, startBal + before);
  const r = avgR(trades);
  const sk = streaks(trades);
  const hold = avgHold(trades);
  const side = sideSplit(trades);
  const names = new Map((st.data ?? []).map((x) => [x.id, x.name]));
  const pf = Number.isFinite(k.profitFactor) ? k.profitFactor.toFixed(2) : "∞";
  const checklist = trades.length ? (trades.filter((x) => x.checklist_passed).length / trades.length) * 100 : 0;
  const openRisk = all.filter((x) => x.status === "open").reduce((a, x) => a + (Number(x.risk_amount) || 0), 0);
  const spark = curve.map((p) => p.balance);
  const days = dailyPnl(all, tz);

  const win = (p: Period) => { const rr = periodRange(p, now, tz)!; return inRange(all, rr.start, rr.end).filter((x) => x.status === "closed").reduce((a, x) => a + (Number(x.pnl) || 0), 0); };
  const S = s.data;
  const goals = [
    { label: "اليوم", pnl: win("today"), target: Number(S?.daily_target) || 0, loss: Number(S?.max_daily_loss) || 0 },
    { label: "الأسبوع", pnl: win("week"), target: Number(S?.weekly_target) || 0, loss: Number(S?.weekly_max_loss) || 0 },
    { label: "الشهر", pnl: win("month"), target: Number(S?.monthly_target) || 0, loss: Number(S?.monthly_max_loss) || 0 },
  ];

  const bySym = groupPnl(trades, (x) => x.symbol);
  const byStrat = groupPnl(trades, (x) => (x.strategy_id && names.get(x.strategy_id)) || "بدون استراتيجية");
  const byEmo = groupPnl(trades, (x) => x.emotion || "غير محدد");
  const byDay = groupPnl(trades, (x) => weekdayName(x, tz));
  const byHour = groupPnl(trades, (x) => hourBucket(x, tz));
  const pLabel = PERIODS.find((p) => p.id === period)!.label;
  const statsText = JSON.stringify({ ...k, profitFactor: pf, avgR: r, maxDrawdownPct: dd.pct, expectancy: expectancy(trades), streaks: sk, side, bySym, byStrat, byEmo, byDay, byHour, checklist });

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader title="الأداء" subtitle={`${trades.length} صفقة · ${k.open} مفتوحة · ${k.closed} مغلقة`} />

      <div className="glass inline-flex rounded-full p-1" role="tablist">
        {PERIODS.map((p) => (
          <button key={p.id} role="tab" aria-selected={period === p.id} onClick={() => nav({ search: { period: p.id } })}
            className={`rounded-full px-4 py-1.5 text-sm transition ${period === p.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{p.label}</button>
        ))}
      </div>

      {openRisk > 0 && <p className="text-sm">المخاطرة الحالية في صفقاتك المفتوحة: <span className="font-data text-destructive" dir="ltr">{fmtMoney(openRisk, cur)}</span></p>}
      <OpenTrades trades={all} currency={cur} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="صافي الربح" value={d(fmtMoney(k.netPnl, cur))} sub={has && startBal > 0 ? `${((k.netPnl / startBal) * 100).toFixed(1)}% من الرصيد` : undefined} delta={has && range ? delta(k.netPnl, kp.netPnl) : null} tone={has ? (k.netPnl >= 0 ? "success" : "destructive") : undefined} spark={spark} />
        <Kpi label="نسبة الفوز" value={d(`${k.winRate.toFixed(0)}%`)} sub={has ? `${k.wins} ربح / ${k.losses} خسارة` : undefined} delta={has && range && kp.closed ? k.winRate - kp.winRate : null} />
        <Kpi label="معامل الربح" value={d(pf)} sub={has ? (k.profitFactor >= 1.5 ? "ممتاز" : k.profitFactor >= 1 ? "مقبول" : "تحت الصفر") : undefined} />
        <Kpi label="متوسط R" value={r == null ? "—" : `${r >= 0 ? "+" : ""}${r.toFixed(2)}R`} sub="ربحك مقابل مخاطرتك" tone={r == null ? undefined : r >= 0 ? "success" : "destructive"} />
      </div>
      {!has && <p className="text-sm text-muted-foreground">أرقام النتائج تطلع أول ما تسكّر صفقة في فترة "{pLabel}".</p>}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2"><EquityChart curve={curve} dd={dd} cur={cur} /></div>
        <Goals rows={goals} cur={cur} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2"><PnlCalendar days={days} trades={all} tz={tz} cur={cur} /></div>
        <CoachInsight period={pLabel} stats={statsText} disabled={!has} />
      </div>

      <div className="panel grid grid-cols-2 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-3 sm:p-5 lg:grid-cols-4">
        <Pro label="المتوقع لكل صفقة" v={d(fmtMoney(expectancy(trades), cur))} />
        <Pro label="أطول سلسلة ربح" v={d(String(sk.maxWin))} />
        <Pro label="أطول سلسلة خسارة" v={d(String(sk.maxLoss))} />
        <Pro label="متوسط مدة الصفقة" v={hold == null ? "—" : hold < 60 ? `${Math.round(hold)} د` : `${(hold / 60).toFixed(1)} س`} />
        <Pro label="متوسط الربح / الخسارة" v={d(`${fmtMoney(k.avgWin, cur)} / ${fmtMoney(-k.avgLoss, cur)}`)} />
        <Pro label="أفضل / أسوأ صفقة" v={d(`${fmtMoney(k.best, cur)} / ${fmtMoney(k.worst, cur)}`)} />
        <Pro label="شراء / بيع" v={d(`${side.long.count} (${fmtMoney(side.long.pnl, cur)}) / ${side.short.count} (${fmtMoney(side.short.pnl, cur)})`)} />
        <Pro label="التزام قائمة الفحص" v={trades.length ? `${checklist.toFixed(0)}%` : "—"} />
      </div>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <Breakdown title="حسب الأصل" data={bySym} cur={cur} />
        <Breakdown title="حسب الاستراتيجية" data={byStrat} cur={cur} />
        <Breakdown title="حسب حالتك النفسية" data={byEmo} cur={cur} />
        <Breakdown title="حسب يوم الأسبوع" data={byDay} cur={cur} />
        <Breakdown title="حسب ساعة الدخول" data={byHour} cur={cur} />
      </div>
    </div>
  );
}

function Pro({ label, v }: { label: string; v: string }) {
  return <div className="space-y-0.5"><div className="text-xs text-muted-foreground">{label}</div><div className="font-data tabular-nums" dir="ltr">{v}</div></div>;
}
