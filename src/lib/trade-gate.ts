/**
 * Trade gate (Phase 2): the one place that decides whether a new trade may be
 * recorded. Used by the new-trade form and by AI-proposed `create_trade`
 * actions, so no path can skip it.
 *
 * Pure and synchronous: callers load the data, this module decides.
 */
import { calcTradeRisk, type TradeRiskCalc } from "./risk-limits";
import {
  computeDayMetrics,
  type DayMetrics,
  type StatusSettings,
  type StatusTrade,
} from "./trading-status";

export type GateCode =
  | "paused"
  | "cooldown"
  | "daily_loss_limit"
  | "weekly_loss_limit"
  | "monthly_loss_limit"
  | "profit_stop"
  | "consecutive_losses"
  | "max_trades"
  | "daily_risk_exceeded"
  | "invalid_prices"
  | "no_session"
  | "no_strategy"
  | "no_stop_loss"
  | "risk_unknown"
  | "risk_per_trade_exceeded";

export interface GateReason {
  code: GateCode;
  message: string;
  /** Hard reasons can never be overridden; soft ones need a written reason. */
  hard: boolean;
}

export interface GateResult {
  allowed: boolean;
  reasons: GateReason[];
  nextAction: string | null;
  /** True when every reason is soft: the user may proceed with a written justification. */
  canOverride: boolean;
  metrics: DayMetrics;
  calc: TradeRiskCalc;
}

export interface GateSettings extends StatusSettings {
  starting_balance: number;
  max_risk_per_trade: number;
}

export interface GateDraft {
  direction: "long" | "short" | string;
  entry?: number | null | undefined;
  stop?: number | null | undefined;
  target?: number | null | undefined;
  size?: number | null | undefined;
  riskInput?: number | null | undefined;
  strategyId?: string | null | undefined;
}

export interface GateInput {
  settings: GateSettings;
  trades: StatusTrade[];
  violationsToday: number;
  hasActiveSession: boolean;
  draft: GateDraft;
  now?: Date;
}

const money = (x: number) => (Math.round(x * 100) / 100).toLocaleString("en-US");

export function evaluateTradeGate(input: GateInput): GateResult {
  const { settings: s, draft, hasActiveSession } = input;
  const now = input.now ?? new Date();
  const m = computeDayMetrics(s, input.trades, input.violationsToday, now);
  const balance =
    s.starting_balance +
    input.trades.reduce((a, t) => a + (t.status === "closed" ? (t.pnl ?? 0) : 0), 0);
  const calc = calcTradeRisk(
    {
      direction: draft.direction,
      entry: draft.entry,
      stop: draft.stop,
      target: draft.target,
      size: draft.size,
      riskInput: draft.riskInput,
    },
    balance,
  );
  const reasons: GateReason[] = [];
  const hard = (code: GateCode, message: string) => reasons.push({ code, message, hard: true });
  const soft = (code: GateCode, message: string) => reasons.push({ code, message, hard: false });

  // 1. Manual pause
  if (s.trading_paused)
    hard("paused", "التداول متوقف يدويًا. استأنفه من صفحة إدارة المخاطر إذا كان ذلك مقصودًا.");

  // 2. Cooldown
  const cooldownEnd = s.cooldown_until ? new Date(s.cooldown_until) : null;
  const inCooldown = !!cooldownEnd && cooldownEnd.getTime() > now.getTime();
  if (inCooldown) {
    const hhmm = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(
      cooldownEnd!,
    );
    hard("cooldown", `أنت في فترة تهدئة حتى ${hhmm}.`);
  }

  // 3. Profit / loss limits
  if (s.max_daily_loss > 0 && m.todayPnl <= -s.max_daily_loss)
    hard("daily_loss_limit", `تم الوصول إلى حد الخسارة اليومية (${money(s.max_daily_loss)}).`);
  if ((s.weekly_max_loss ?? 0) > 0 && m.weekPnl <= -s.weekly_max_loss!)
    hard("weekly_loss_limit", `تم الوصول إلى حد الخسارة الأسبوعية (${money(s.weekly_max_loss!)}).`);
  if ((s.monthly_max_loss ?? 0) > 0 && m.monthPnl <= -s.monthly_max_loss!)
    hard("monthly_loss_limit", `تم الوصول إلى حد الخسارة الشهرية (${money(s.monthly_max_loss!)}).`);
  if (s.max_daily_profit > 0 && m.todayPnl >= s.max_daily_profit)
    hard(
      "profit_stop",
      `تم الوصول إلى حد إيقاف الربح اليومي (${money(s.max_daily_profit)}). احمِ ربحك.`,
    );

  // 4. Consecutive losses (today)
  if (s.max_consecutive_losses > 0 && m.consecutiveLosses >= s.max_consecutive_losses)
    hard("consecutive_losses", `${m.consecutiveLosses} خسائر متتالية اليوم، وهو الحد الذي حددته.`);

  // 5. Trade count
  if (s.max_trades_per_day > 0 && m.tradesToday >= s.max_trades_per_day)
    hard("max_trades", `نفذت ${m.tradesToday} صفقات اليوم من أصل ${s.max_trades_per_day} مسموحة.`);

  // 6. Daily risk
  if (s.max_daily_risk > 0 && calc.risk != null && m.riskUsed + calc.risk > s.max_daily_risk)
    hard(
      "daily_risk_exceeded",
      `هذه الصفقة ترفع مخاطرة اليوم إلى ${money(m.riskUsed + calc.risk)} من حد ${money(s.max_daily_risk)}.`,
    );

  // Structural price problems are hard: the numbers do not describe a real trade.
  for (const p of calc.problems) hard("invalid_prices", p);

  // 7. Active session
  if (!hasActiveSession) soft("no_session", "لا توجد جلسة تداول نشطة. ابدأ جلسة واكتب خطتك أولًا.");

  // 8. Strategy
  if (!draft.strategyId) soft("no_strategy", "لم يتم اختيار استراتيجية لهذه الصفقة.");

  // 9. Stop loss
  if (draft.stop == null || !Number.isFinite(draft.stop))
    soft("no_stop_loss", "لم يتم تحديد وقف الخسارة.");

  // 10. Risk size
  if (calc.risk == null)
    soft(
      "risk_unknown",
      "مبلغ المخاطرة غير معروف: أدخل الدخول والوقف والحجم، أو اكتب مبلغ المخاطرة.",
    );
  else if (s.max_risk_per_trade > 0 && calc.risk > s.max_risk_per_trade)
    soft(
      "risk_per_trade_exceeded",
      `مخاطرة الصفقة ${money(calc.risk)} أعلى من حدك لكل صفقة (${money(s.max_risk_per_trade)}).`,
    );

  const anyHard = reasons.some((r) => r.hard);
  return {
    allowed: reasons.length === 0,
    reasons,
    nextAction: nextActionFor(reasons),
    canOverride: reasons.length > 0 && !anyHard,
    metrics: m,
    calc,
  };
}

function nextActionFor(reasons: GateReason[]): string | null {
  const has = (c: GateCode) => reasons.some((r) => r.code === c);
  if (reasons.length === 0) return null;
  if (has("cooldown")) return "انتظر انتهاء فترة التهدئة وراجع آخر صفقة.";
  if (has("consecutive_losses")) return "ابدأ فترة تهدئة 30 دقيقة وراجع صفقاتك الخاسرة.";
  if (has("daily_loss_limit") || has("weekly_loss_limit") || has("monthly_loss_limit"))
    return "توقف عن التداول اليوم وراجع أداءك.";
  if (has("profit_stop")) return "أنهِ الجلسة واحفظ ربحك.";
  if (has("max_trades")) return "أنهِ الجلسة واكتب مراجعتها.";
  if (has("paused")) return "راجع سبب الإيقاف قبل استئناف التداول.";
  if (has("daily_risk_exceeded")) return "خفّض حجم الصفقة أو انتظر الغد.";
  if (has("invalid_prices")) return "صحّح أسعار الدخول والوقف والهدف.";
  if (has("no_session")) return "ابدأ جلسة التداول.";
  if (has("no_stop_loss")) return "حدد وقف الخسارة قبل الدخول.";
  if (has("no_strategy")) return "اختر الاستراتيجية التي تنطبق على الصفقة.";
  return "راجع الأسباب أعلاه قبل المتابعة.";
}

/** Minimum length for a written override justification. */
export const OVERRIDE_MIN_CHARS = 15;

/** Text stored in `rule_violations.note` when the user overrides soft reasons. */
export function overrideNote(reasons: GateReason[], justification: string) {
  return `استثناء من بوابة التداول: ${reasons.map((r) => r.message).join(" | ")} — سبب المستخدم: ${justification.trim()}`;
}
