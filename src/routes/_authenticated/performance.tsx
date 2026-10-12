import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState, Loading, PageHeader, Stat } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { fmtMoney, settingsQuery, strategiesQuery, tradesQuery } from "@/lib/queries";
import { equityCurve, groupPnl, tradeStats } from "@/lib/stats";

export const Route = createFileRoute("/_authenticated/performance")({
  head: () => ({ meta: [{ title: "الأداء — نظام هادي" }, { name: "description", content: "أرقام أدائك الحقيقية من صفقاتك." }] }),
  component: PerformancePage,
});

const tip = { contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--foreground)" } };

function PerformancePage() {
  const t = useQuery(tradesQuery);
  const s = useQuery(settingsQuery);
  const st = useQuery(strategiesQuery);
  if (t.isLoading) return <Loading />;
  const trades = t.data ?? [];
  const cur = s.data?.currency ?? "USD";
  const k = tradeStats(trades);
  if (trades.length === 0) return (
    <div className="mx-auto max-w-5xl"><PageHeader title="الأداء" /><EmptyState text="لا توجد بيانات بعد. سجّل أول صفقة عن طريق المدرب." action={<Button asChild><Link to="/coach">كلّم المدرب</Link></Button>} /></div>
  );
  const names = new Map((st.data ?? []).map((x) => [x.id, x.name]));
  const closedTrades = trades.filter((x) => x.status === "closed");
  const curve = equityCurve(trades, Number(s.data?.starting_balance) || 0);
  const bySym = groupPnl(trades, (x) => x.symbol);
  const byStrat = groupPnl(trades, (x) => (x.strategy_id && names.get(x.strategy_id)) || "بدون استراتيجية");
  const byEmo = groupPnl(trades, (x) => x.emotion || "غير محدد");
  const pf = Number.isFinite(k.profitFactor) ? k.profitFactor.toFixed(2) : "∞";
  const openRisk = trades.filter((x) => x.status === "open").reduce((a, x) => a + (Number(x.risk_amount) || 0), 0);
  const has = k.closed > 0;
  const d = (v: string) => (has ? v : "—");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="الأداء" subtitle={`${trades.length} صفقة · ${k.open} مفتوحة · ${k.closed} مغلقة`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="كل الصفقات" value={String(trades.length)} />
        <Stat label="مفتوحة" value={String(k.open)} />
        <Stat label="مغلقة" value={String(k.closed)} />
        <Stat label="المخاطرة الحالية" value={fmtMoney(openRisk, cur)} tone={openRisk > 0 ? "destructive" : undefined} />
      </div>
      <OpenTrades trades={trades} currency={cur} />
      {!has && <p className="text-sm text-muted-foreground">أرقام النتائج تطلع أول ما تسكّر صفقة.</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="صافي الربح" value={d(fmtMoney(k.netPnl, cur))} tone={has ? (k.netPnl >= 0 ? "success" : "destructive") : undefined} />
        <Stat label="نسبة الفوز" value={d(`${k.winRate.toFixed(1)}%`)} />
        <Stat label="معامل الربح" value={d(pf)} />
        <Stat label="رابحة / خاسرة" value={d(`${k.wins} / ${k.losses}`)} />
        <Stat label="متوسط الربح" value={d(fmtMoney(k.avgWin, cur))} tone={has ? "success" : undefined} />
        <Stat label="متوسط الخسارة" value={d(fmtMoney(-k.avgLoss, cur))} tone={has ? "destructive" : undefined} />
        <Stat label="أفضل صفقة" value={d(fmtMoney(k.best, cur))} />
        <Stat label="أسوأ صفقة" value={d(fmtMoney(k.worst, cur))} />
      </div>
      {has && closedTrades.length > 0 && <>

      <div className="panel p-5">
        <h2 className="mb-4 font-semibold">منحنى الرصيد</h2>
        <div className="h-64" dir="ltr">
          <ResponsiveContainer><AreaChart data={curve}><CartesianGrid stroke="var(--border)" /><XAxis dataKey="n" stroke="var(--muted-foreground)" /><YAxis stroke="var(--muted-foreground)" /><Tooltip {...tip} /><Area dataKey="balance" name="الرصيد" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.12} /></AreaChart></ResponsiveContainer>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Group title="حسب الأصل" data={bySym} cur={cur} />
        <Group title="حسب الاستراتيجية" data={byStrat} cur={cur} />
        <Group title="حسب الحالة النفسية" data={byEmo} cur={cur} />
      </div>
    </div>
  );
}

function Group({ title, data, cur }: { title: string; data: { name: string; pnl: number; count: number; wins: number }[]; cur: string }) {
  return (
    <div className="panel p-5">
      <h2 className="mb-4 font-semibold">{title}</h2>
      <div className="h-48" dir="ltr">
        <ResponsiveContainer><BarChart data={data}><XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={11} /><YAxis stroke="var(--muted-foreground)" fontSize={11} /><Tooltip {...tip} /><Bar dataKey="pnl" name="الربح" fill="var(--chart-2)" radius={4} /></BarChart></ResponsiveContainer>
      </div>
      <div className="mt-3 space-y-1 text-sm">
        {data.map((g) => (
          <div key={g.name} className="flex justify-between"><span>{g.name} <span className="text-xs text-muted-foreground">({g.count} · فوز {Math.round((g.wins / g.count) * 100)}%)</span></span><span className={`font-data ${g.pnl >= 0 ? "text-success" : "text-destructive"}`} dir="ltr">{fmtMoney(g.pnl, cur)}</span></div>
        ))}
      </div>
    </div>
  );
}
