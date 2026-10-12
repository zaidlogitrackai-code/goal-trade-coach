export type DailyPlan = { target: number | null; max_trades: number | null; risk_per_trade: number | null; max_loss: number | null; revised_count: number };
type T = { status: string; pnl: unknown; risk_amount: unknown; opened_at: string };
type S = { starting_balance?: unknown; current_balance?: unknown; max_daily_profit?: unknown; max_risk_per_trade?: unknown };

/** Flags greed and plan breaches for today's plan. Pure; thresholds: >3% of balance, above profit cap, above avg winning day. */
export function planCheck(plan: DailyPlan | null, todayTrades: T[], s: S, avgWinDay: number | null) {
  const flags: string[] = [];
  if (!plan) return { flags: ["ما حدد خطة اليوم بعد"], kept: null as boolean | null, pnl: 0, count: todayTrades.length };
  const bal = Number(s.current_balance ?? s.starting_balance) || 0, cap = Number(s.max_daily_profit) || 0, maxRisk = Number(s.max_risk_per_trade) || 0;
  const t = plan.target ?? 0;
  if (t > 0 && bal > 0 && t / bal > 0.03) flags.push(`طمع: الهدف ${t} = ${((t / bal) * 100).toFixed(1)}% من الرصيد (أكثر من 3%)`);
  if (t > 0 && cap > 0 && t > cap) flags.push(`طمع: الهدف ${t} أكبر من سقف الربح ${cap}`);
  if (t > 0 && avgWinDay != null && avgWinDay > 0 && t > avgWinDay * 2) flags.push(`طمع: الهدف أكثر من ضعف متوسط يومك الرابح (${Math.round(avgWinDay)})`);
  if (plan.risk_per_trade != null && maxRisk > 0 && plan.risk_per_trade > maxRisk) flags.push(`الستوب ${plan.risk_per_trade} أكبر من حد المخاطرة ${maxRisk}`);
  if (plan.revised_count > 0) flags.push(`غيّر خطته ${plan.revised_count} مرة اليوم`);
  const count = todayTrades.length;
  const pnl = todayTrades.filter((x) => x.status === "closed").reduce((a, x) => a + (Number(x.pnl) || 0), 0);
  let kept = true;
  if (plan.max_trades != null && count > plan.max_trades) { kept = false; flags.push(`تعدّى عدد الصفقات: ${count} من ${plan.max_trades}`); }
  if (plan.risk_per_trade != null && todayTrades.some((x) => Number(x.risk_amount) > plan.risk_per_trade!)) { kept = false; flags.push("صفقة خاطرت أكثر من الستوب المخطط"); }
  if (plan.max_loss != null && pnl < -plan.max_loss) { kept = false; flags.push(`تعدّى أقصى خسارة: ${pnl} من -${plan.max_loss}`); }
  return { flags, kept, pnl, count };
}

/** Today's target: the one Hadi chose in today's plan wins over the settings default. */
export function effectiveDailyTarget(planTarget: number | null | undefined, settingsTarget: number | null | undefined): number {
  const p = Number(planTarget);
  return p > 0 ? p : Number(settingsTarget) || 0;
}
