import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Stat, Loading, EmptyState } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { settingsQuery, tradesQuery, violationsQuery, fmtMoney } from "@/lib/queries";
import { computeDayMetrics, computeStatus, startOfToday, STATUS_META } from "@/lib/trading-status";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "حالة التداول اليوم — نظام هادي" }, { name: "description", content: "هل مسموح لك تتداول اليوم؟" }] }),
  component: Dashboard,
});

const TONE = {
  success: "border-success/40 text-success glow-success",
  warning: "border-warning/40 text-warning",
  destructive: "border-destructive/50 text-destructive",
  primary: "border-primary/50 text-primary glow-primary",
} as const;

function Dashboard() {
  const s = useQuery(settingsQuery);
  const t = useQuery(tradesQuery);
  const v = useQuery(violationsQuery);
  if (s.isLoading || t.isLoading || v.isLoading || !s.data) return <Loading />;
  const settings = s.data;
  const trades = t.data ?? [];
  const start = startOfToday().getTime();
  const violationsToday = (v.data ?? []).filter((x) => new Date(x.occurred_at).getTime() >= start).length;
  const m = computeDayMetrics(settings, trades, violationsToday);
  const status = computeStatus(settings, m);
  const meta = STATUS_META[status];
  const cur = settings.currency;
  const balance = settings.starting_balance + trades.reduce((a, x) => a + (x.status === "closed" ? x.pnl ?? 0 : 0), 0);
  const lim = (n: number) => (n > 0 ? fmtMoney(n, cur) : "غير محدد");
  const openTrades = trades.filter((x) => x.status === "open");

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="حالة التداول اليوم"
        subtitle={new Intl.DateTimeFormat("ar-SA-u-nu-latn", { dateStyle: "full" }).format(new Date())}
        action={<Button asChild><Link to="/new-trade">صفقة جديدة</Link></Button>}
      />

      <div className={`panel mb-6 border-2 p-8 ${TONE[meta.tone]}`}>
        <p className="text-sm text-muted-foreground">الحالة الآن</p>
        <p className="mt-2 font-display text-4xl font-bold lg:text-5xl">{meta.label}</p>
        <p className="mt-3 text-foreground/80">{meta.hint}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Stat label="الرصيد الحالي" value={fmtMoney(balance, cur)} />
        <Stat label="ربح / خسارة اليوم" value={fmtMoney(m.todayPnl, cur)} tone={m.todayPnl > 0 ? "success" : m.todayPnl < 0 ? "destructive" : undefined} />
        <Stat label="الهدف اليومي" value={lim(settings.daily_target)} />
        <Stat label="الحد الأقصى للربح" value={lim(settings.max_daily_profit)} />
        <Stat label="الحد الأقصى للخسارة" value={lim(settings.max_daily_loss)} />
        <Stat label="عدد الصفقات اليوم" value={m.tradesToday} />
        <Stat label="الصفقات المتبقية" value={m.tradesRemaining ?? "غير محدد"} />
        <Stat label="المخاطرة المستخدمة" value={fmtMoney(m.riskUsed, cur)} />
        <Stat label="المخاطرة المتبقية" value={m.riskRemaining != null ? fmtMoney(m.riskRemaining, cur) : "غير محدد"} tone={m.riskRemaining === 0 ? "destructive" : undefined} />
        <Stat label="الخسائر المتتالية" value={m.consecutiveLosses} tone={m.consecutiveLosses > 0 ? "warning" : undefined} />
      </div>

      <h2 className="mb-3 mt-10 text-lg font-semibold">الصفقات المفتوحة</h2>
      {openTrades.length === 0 ? (
        <EmptyState title="لا توجد صفقات مفتوحة" text={trades.length === 0 ? "لا توجد بيانات بعد. سجّل أول صفقة لك." : "كل صفقاتك مغلقة."} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {openTrades.map((x) => (
            <Link key={x.id} to="/trades" className="panel flex items-center justify-between p-4 hover:border-primary/50">
              <div>
                <p className="font-data font-semibold" dir="ltr">{x.symbol}</p>
                <p className="text-xs text-muted-foreground">{x.direction === "long" ? "شراء" : "بيع"}</p>
              </div>
              <p className="font-data text-sm text-muted-foreground" dir="ltr">مخاطرة {fmtMoney(x.risk_amount, cur)}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
