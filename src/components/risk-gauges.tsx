import type { DayMetrics, StatusSettings } from "@/lib/trading-status";

function money(n: number) {
  const v = Math.round(n * 100) / 100;
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US")}`;
}

function Gauge({ label, value, sub, used, max }: { label: string; value: string; sub: string; used: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (used / max) * 100)) : 0;
  const tone = max <= 0 ? "bg-muted-foreground/40" : pct >= 100 ? "bg-destructive" : pct >= 70 ? "bg-warning" : "bg-success";
  return (
    <div className="panel min-w-0 p-3">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate font-display text-base font-semibold tabular-nums">{value}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 truncate text-[11px] text-muted-foreground tabular-nums">{sub}</p>
    </div>
  );
}

export function RiskGauges({ s, m }: { s: StatusSettings; m: DayMetrics }) {
  const lossUsed = Math.max(0, -m.todayPnl);
  return (
    <div className="mb-2 grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-4">
      <Gauge label="باقي من حد الخسارة" value={s.max_daily_loss > 0 ? money(Math.max(0, s.max_daily_loss - lossUsed)) : "غير محدد"}
        sub={`نتيجة اليوم ${money(m.todayPnl)}`} used={lossUsed} max={s.max_daily_loss} />
      <Gauge label="المخاطرة المستخدمة اليوم" value={money(m.riskUsed)}
        sub={s.max_daily_risk > 0 ? `من ${money(s.max_daily_risk)} يوميًا` : "بدون سقف"} used={m.riskUsed} max={s.max_daily_risk} />
      <Gauge label="الصفقات اليوم" value={`${m.tradesToday}${s.max_trades_per_day > 0 ? ` / ${s.max_trades_per_day}` : ""}`}
        sub={m.tradesRemaining != null ? `باقي ${m.tradesRemaining}` : "بدون حد"} used={m.tradesToday} max={s.max_trades_per_day} />
      <Gauge label="خسائر متتالية" value={`${m.consecutiveLosses}${s.max_consecutive_losses > 0 ? ` / ${s.max_consecutive_losses}` : ""}`}
        sub={m.consecutiveLosses === 0 ? "ممتاز" : "خفّف وارتح"} used={m.consecutiveLosses} max={s.max_consecutive_losses} />
    </div>
  );
}
