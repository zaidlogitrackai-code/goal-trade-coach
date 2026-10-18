import { dayStart, monthStart, weekStart } from "./trading-day";

export type TradingStatus =
  | "ready"
  | "caution"
  | "high_risk"
  | "rules_broken"
  | "target_hit"
  | "loss_limit"
  | "stopped";

export interface StatusSettings {
  daily_target: number;
  max_daily_profit: number;
  max_daily_loss: number;
  max_trades_per_day: number;
  max_daily_risk: number;
  max_consecutive_losses: number;
  trading_paused: boolean;
  cooldown_until?: string | null;
  weekly_target?: number;
  weekly_max_loss?: number;
  monthly_target?: number;
  monthly_max_loss?: number;
  /** trading_settings.timezone: day/week/month windows follow the trader's clock. */
  timezone?: string | null;
}

export interface StatusTrade {
  status: "open" | "closed" | string;
  pnl: number | null;
  risk_amount: number;
  opened_at: string;
  closed_at: string | null;
}

export interface DayMetrics {
  todayPnl: number;
  tradesToday: number;
  tradesRemaining: number | null;
  riskUsed: number;
  riskRemaining: number | null;
  lossRemaining: number | null;
  consecutiveLosses: number;
  violationsToday: number;
  weekPnl: number;
  monthPnl: number;
}

function pnlSince(trades: StatusTrade[], since: number) {
  return trades.filter((t) => t.status === "closed" && t.closed_at && new Date(t.closed_at).getTime() >= since).reduce((a, t) => a + (t.pnl ?? 0), 0);
}

/** Losses in a row counting back from the most recently closed trade. */
export function countConsecutiveLosses(trades: StatusTrade[]): number {
  const closed = trades
    .filter((t) => t.status === "closed" && t.closed_at)
    .sort((a, b) => (b.closed_at! > a.closed_at! ? 1 : -1));
  let n = 0;
  for (const t of closed) {
    if ((t.pnl ?? 0) < 0) n++;
    else break;
  }
  return n;
}

export function computeDayMetrics(
  s: StatusSettings,
  allTrades: StatusTrade[],
  violationsToday: number,
  now = new Date(),
): DayMetrics {
  const start = dayStart(now, s.timezone).getTime();
  const today = allTrades.filter((t) => new Date(t.opened_at).getTime() >= start);
  const closedToday = allTrades.filter(
    (t) => t.status === "closed" && t.closed_at && new Date(t.closed_at).getTime() >= start,
  );
  const todayPnl = closedToday.reduce((a, t) => a + (t.pnl ?? 0), 0);
  const riskUsed = today.reduce((a, t) => a + (t.risk_amount ?? 0), 0);
  return {
    todayPnl,
    tradesToday: today.length,
    tradesRemaining: s.max_trades_per_day > 0 ? Math.max(0, s.max_trades_per_day - today.length) : null,
    riskUsed,
    riskRemaining: s.max_daily_risk > 0 ? Math.max(0, s.max_daily_risk - riskUsed) : null,
    lossRemaining: s.max_daily_loss > 0 ? Math.max(0, s.max_daily_loss + Math.min(0, todayPnl)) : null,
    // Today's streak only: an all-time streak would block trading forever,
    // because no new trade (and so no win) could ever be recorded.
    consecutiveLosses: countConsecutiveLosses(closedToday),
    violationsToday,
    weekPnl: pnlSince(allTrades, weekStart(now, s.timezone).getTime()),
    monthPnl: pnlSince(allTrades, monthStart(now, s.timezone).getTime()),
  };
}

export function computeStatus(s: StatusSettings, m: DayMetrics, now: Date = new Date()): TradingStatus {
  if (s.trading_paused) return "stopped";
  if (s.cooldown_until && new Date(s.cooldown_until).getTime() > now.getTime()) return "stopped";
  if (s.max_daily_loss > 0 && m.todayPnl <= -s.max_daily_loss) return "loss_limit";
  if ((s.weekly_max_loss ?? 0) > 0 && m.weekPnl <= -s.weekly_max_loss!) return "loss_limit";
  if ((s.monthly_max_loss ?? 0) > 0 && m.monthPnl <= -s.monthly_max_loss!) return "loss_limit";
  if ((s.weekly_target ?? 0) > 0 && m.weekPnl >= s.weekly_target!) return "target_hit";
  if ((s.monthly_target ?? 0) > 0 && m.monthPnl >= s.monthly_target!) return "target_hit";
  if (s.max_daily_profit > 0 && m.todayPnl >= s.max_daily_profit) return "stopped";
  if (s.max_trades_per_day > 0 && m.tradesToday >= s.max_trades_per_day) return "stopped";
  if (s.max_consecutive_losses > 0 && m.consecutiveLosses >= s.max_consecutive_losses) return "stopped";
  if (m.violationsToday > 0) return "rules_broken";
  if (s.max_daily_risk > 0 && m.riskUsed > s.max_daily_risk) return "rules_broken";
  if (s.daily_target > 0 && m.todayPnl >= s.daily_target) return "target_hit";
  const lossRatio = s.max_daily_loss > 0 ? Math.max(0, -m.todayPnl) / s.max_daily_loss : 0;
  const riskRatio = s.max_daily_risk > 0 ? m.riskUsed / s.max_daily_risk : 0;
  if (lossRatio >= 0.7 || riskRatio >= 0.8) return "high_risk";
  const nearStreak = s.max_consecutive_losses > 1 && m.consecutiveLosses >= s.max_consecutive_losses - 1;
  if (lossRatio >= 0.4 || riskRatio >= 0.5 || nearStreak) return "caution";
  return "ready";
}

export const STATUS_META: Record<TradingStatus, { label: string; hint: string; tone: "success" | "warning" | "destructive" | "primary" }> = {
  ready: { label: "جاهز للتداول", hint: "كل الحدود ضمن النطاق الآمن. التزم بخطتك.", tone: "success" },
  caution: { label: "حذر", hint: "اقتربت من حدودك. خفف الحجم وتأكد من الإعداد.", tone: "warning" },
  high_risk: { label: "مخاطرة مرتفعة", hint: "مخاطرتك أو خسارتك قريبة من الحد. فكّر بالتوقف.", tone: "destructive" },
  rules_broken: { label: "تجاوز القواعد", hint: "تم تسجيل مخالفة اليوم. راجع قواعدك قبل أي صفقة.", tone: "destructive" },
  target_hit: { label: "الهدف تحقق", hint: "حققت هدفك (اليومي أو الأسبوعي أو الشهري). احمِ أرباحك ولا تطمع.", tone: "success" },
  loss_limit: { label: "تم الوصول إلى حد الخسارة", hint: "وصلت لحد الخسارة (اليومي أو الأسبوعي أو الشهري). توقف، السوق باقي ورأس مالك أهم.", tone: "destructive" },
  stopped: { label: "التداول متوقف", hint: "وصلت لأحد حدودك اليومية أو أوقفت التداول يدوياً.", tone: "primary" },
};
