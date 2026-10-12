import { Link } from "@tanstack/react-router";
import { TrendingUp, Shield, Activity, Flame, type LucideIcon } from "lucide-react";

interface CoreMetricsProps {
  todayPnl: number;
  dailyTarget: number;
  maxDailyProfit: number;
  maxDailyLoss: number;
  currency: string;
  riskRemaining: number | null;
  maxDailyRisk: number;
  tradesRemaining: number | null;
  maxTradesPerDay: number;
  tradesToday: number;
  consecutiveLosses: number;
  maxConsecutiveLosses: number;
}

/** Whole numbers without ".00" — cleaner cards. */
export function money(n: number | null | undefined, currency = "USD") {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
  }).format(n);
}

function Card({ to, label, Icon, value, tone, sub }: {
  to: string; label: string; Icon: LucideIcon; value: string; tone?: string; sub: string;
}) {
  return (
    <Link
      to={to}
      className="panel group flex min-w-0 flex-col justify-between gap-3 p-4 transition-colors hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:min-h-[8.5rem] lg:p-5"
    >
      <div className="flex items-center justify-between gap-2 text-muted-foreground">
        <span className="truncate text-xs font-medium lg:text-[13px]">{label}</span>
        <Icon className="size-4 shrink-0 opacity-70" aria-hidden="true" />
      </div>
      <span dir="ltr" className={`font-data text-right text-2xl font-semibold tabular-nums tracking-tight lg:text-[2rem] ${tone ?? "text-foreground"}`}>
        {value}
      </span>
      <p className="truncate text-xs text-muted-foreground">{sub}</p>
    </Link>
  );
}

export function CoreMetrics(p: CoreMetricsProps) {
  const c = p.currency;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      <Card to="/performance" label="ربح / خسارة اليوم" Icon={TrendingUp}
        value={money(p.todayPnl, c)}
        tone={p.todayPnl > 0 ? "text-success" : p.todayPnl < 0 ? "text-destructive" : undefined}
        sub={p.dailyTarget > 0 ? `الهدف ${money(p.dailyTarget, c)}` : "بدون هدف"} />
      <Card to="/risk" label="المخاطرة المتبقية" Icon={Shield}
        value={p.riskRemaining != null ? money(p.riskRemaining, c) : "—"}
        tone={p.riskRemaining === 0 ? "text-destructive" : undefined}
        sub={p.maxDailyRisk > 0 ? `من ${money(p.maxDailyRisk, c)}` : "بدون حد"} />
      <Card to="/trades" label="الصفقات المتبقية" Icon={Activity}
        value={p.tradesRemaining != null ? String(p.tradesRemaining) : "—"}
        tone={p.tradesRemaining === 0 ? "text-destructive" : undefined}
        sub={p.maxTradesPerDay > 0 ? `${p.tradesToday} من ${p.maxTradesPerDay} اليوم` : "بدون حد"} />
      <Card to="/discipline" label="الخسائر المتتالية" Icon={Flame}
        value={String(p.consecutiveLosses)}
        tone={p.maxConsecutiveLosses > 0 && p.consecutiveLosses >= p.maxConsecutiveLosses ? "text-destructive" : p.consecutiveLosses === 0 ? "text-success" : "text-warning"}
        sub={p.maxConsecutiveLosses > 0 ? `الحد ${p.maxConsecutiveLosses}` : "بدون حد"} />
    </div>
  );
}
