import { fmtMoney } from "@/lib/money";
import type { DayMetrics, StatusSettings } from "@/lib/trading-status";

function Gauge({ label, short, value, sub, used, max }: { label: string; short: string; value: string; sub: string; used: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (used / max) * 100)) : 0;
  const tone = max <= 0 ? "bg-muted-foreground/40" : pct >= 100 ? "bg-destructive" : pct >= 70 ? "bg-warning" : "bg-success";
  return (
    <div className="panel min-w-0 p-2 sm:p-3" title={label}>
      {/* Wraps to two lines instead of cutting the Arabic word; never under 12px. */}
      <p className="line-clamp-2 text-xs leading-normal text-muted-foreground"><span className="sm:hidden">{short}</span><span className="hidden sm:inline">{label}</span></p>
      <p className="mt-0.5 truncate font-display text-sm font-semibold tabular-nums sm:text-base">{value}</p>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted sm:mt-2 sm:h-1.5">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 hidden text-xs leading-normal text-muted-foreground tabular-nums sm:line-clamp-2">{sub}</p>
    </div>
  );
}

export function RiskGauges({ s, m }: { s: StatusSettings & { currency?: string | null }; m: DayMetrics }) {
  const money = (n: number) => fmtMoney(n, s.currency, { trim: true });
  const lossUsed = Math.max(0, -m.todayPnl);
  return (
    <div className="mb-2 grid shrink-0 grid-cols-4 gap-1.5 sm:gap-2">
      <Gauge label="باقي من حد الخسارة" short="باقي للخسارة" value={s.max_daily_loss > 0 ? money(Math.max(0, s.max_daily_loss - lossUsed)) : "غير محدد"}
        sub={`نتيجة اليوم ${money(m.todayPnl)}`} used={lossUsed} max={s.max_daily_loss} />
      <Gauge label="المخاطرة المستخدمة اليوم" short="المخاطرة" value={money(m.riskUsed)}
        sub={s.max_daily_risk > 0 ? `من ${money(s.max_daily_risk)} يوميًا` : "بدون سقف"} used={m.riskUsed} max={s.max_daily_risk} />
      <Gauge label="الصفقات اليوم" short="الصفقات" value={`${m.tradesToday}${s.max_trades_per_day > 0 ? ` / ${s.max_trades_per_day}` : ""}`}
        sub={m.tradesRemaining != null ? `باقي ${m.tradesRemaining}` : "بدون حد"} used={m.tradesToday} max={s.max_trades_per_day} />
      <Gauge label="خسائر متتالية" short="خسائر متتالية" value={`${m.consecutiveLosses}${s.max_consecutive_losses > 0 ? ` / ${s.max_consecutive_losses}` : ""}`}
        sub={m.consecutiveLosses === 0 ? "ممتاز" : "خفّف وارتح"} used={m.consecutiveLosses} max={s.max_consecutive_losses} />
    </div>
  );
}
