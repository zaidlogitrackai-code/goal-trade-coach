import type { StatusSettings, DayMetrics, StatusTrade } from "./trading-status";
import { isSensitive } from "./emotions";
import { safeTz } from "./trading-day";

export interface TradeInput {
  symbol: string;
  direction: "long" | "short" | string;
  entry_price?: number | null;
  stop_loss?: number | null;
  take_profit?: number | null;
  position_size?: number | null;
  risk_amount?: number | null;
  strategy_id?: string | null;
  emotion?: string | null;
  notes?: string | null;
  checklist_passed?: boolean;
}

export interface TradeGateMetrics {
  /** null when the risk can't be known (no stop or size): unknown must never read as a safe 0. */
  tradeRisk: number | null;
  riskPercentOfBalance: number | null;
  totalOpenRisk: number;
  remainingDailyRisk: number | null;
  remainingTrades: number | null;
  remainingLossBeforeStop: number | null;
  remainingProfitBeforeTarget: number | null;
  rewardToRiskRatio: number | null;
}

export interface TradeGateResult {
  allowed: boolean;
  canOverride: boolean;
  reasons: string[];
  warnings: string[];
  nextAction: string;
  metrics: TradeGateMetrics;
}

export interface SessionContext {
  id: string;
  started_at: string;
  plan?: string | null;
  mood?: string | null;
}

/**
 * Calculates Reward to Risk Ratio without guessing or interpolating missing data.
 */
export function calculateRewardToRisk(input: {
  direction: string;
  entry_price?: number | null;
  stop_loss?: number | null;
  take_profit?: number | null;
}): number | null {
  const { direction, entry_price, stop_loss, take_profit } = input;
  if (
    entry_price == null ||
    stop_loss == null ||
    take_profit == null ||
    !Number.isFinite(entry_price) ||
    !Number.isFinite(stop_loss) ||
    !Number.isFinite(take_profit)
  ) {
    return null;
  }

  if (direction === "long") {
    const riskDistance = entry_price - stop_loss;
    const rewardDistance = take_profit - entry_price;
    if (riskDistance <= 0 || rewardDistance <= 0) return null;
    return Math.round((rewardDistance / riskDistance) * 100) / 100;
  } else if (direction === "short") {
    const riskDistance = stop_loss - entry_price;
    const rewardDistance = entry_price - take_profit;
    if (riskDistance <= 0 || rewardDistance <= 0) return null;
    return Math.round((rewardDistance / riskDistance) * 100) / 100;
  }
  return null;
}

/**
 * Evaluates trade against risk parameters, session, emotions, and trading limits.
 */
export function evaluateTradeGate(options: {
  settings: StatusSettings & { starting_balance?: number; current_balance?: number; max_risk_per_trade?: number; currency?: string };
  metrics: DayMetrics;
  input: TradeInput;
  activeSession?: SessionContext | null;
  allowedStrategyIds?: string[];
  openTrades?: StatusTrade[];
  currentBalance?: number;
  now?: Date;
}): TradeGateResult {
  const {
    settings,
    metrics,
    input,
    activeSession = null,
    allowedStrategyIds = [],
    openTrades = [],
    currentBalance = (settings.current_balance ?? settings.starting_balance ?? 1000),
    now = new Date(),
  } = options;

  // Advisory only: the system manages greed, it never blocks trading.
  const reasons: string[] = [];
  const warnings: string[] = [];
  let nextAction = "راجع خطة الصفقة وتأكد من الالتزام بشروط الاستراتيجية";

  const riskIn = input.risk_amount == null ? NaN : Number(input.risk_amount);
  const tradeRisk = Number.isFinite(riskIn) ? Math.max(0, riskIn) : null;
  const totalOpenRisk = openTrades.reduce((acc, t) => acc + (t.status === "open" ? (t.risk_amount ?? 0) : 0), 0);
  const riskPercentOfBalance = tradeRisk != null && currentBalance > 0 ? Math.round((tradeRisk / currentBalance) * 10000) / 100 : null;
  const r2r = calculateRewardToRisk(input);

  const remainingDailyRisk =
    settings.max_daily_risk > 0
      ? Math.max(0, settings.max_daily_risk - metrics.riskUsed)
      : null;

  const remainingTrades =
    settings.max_trades_per_day > 0
      ? Math.max(0, settings.max_trades_per_day - metrics.tradesToday)
      : null;

  const remainingLossBeforeStop =
    settings.max_daily_loss > 0
      ? Math.max(0, settings.max_daily_loss + Math.min(0, metrics.todayPnl))
      : null;

  const remainingProfitBeforeTarget =
    settings.daily_target > 0
      ? Math.max(0, settings.daily_target - Math.max(0, metrics.todayPnl))
      : null;

  // 1. Manual Pause
  if (settings.trading_paused) {
    warnings.push("التداول موقوف يدوياً.");
    nextAction = "استأنف التداول من صفحة إدارة المخاطر إذا كنت جاهزاً ذهنياً";
  }

  // 2. Active Cooldown
  if (settings.cooldown_until && new Date(settings.cooldown_until).getTime() > now.getTime()) {
    const endStr = new Date(settings.cooldown_until).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit", timeZone: safeTz(settings.timezone) });
    warnings.push(`فترة تهدئة نشطة حتى ${endStr}.`);
    nextAction = "ابتعد عن الشاشة وانتظر حتى انتهاء فترة التهدئة لمنع القرارات الانفعالية";
  }

  // 3. Daily Loss Limit
  if (settings.max_daily_loss > 0 && metrics.todayPnl <= -settings.max_daily_loss) {
    warnings.push("تم الوصول إلى الحد الأقصى للخسارة اليومية (توقف إجباري).");
    nextAction = "أغلق المنصة لليوم، السوق مستمر ورأس مالك أهم";
  }

  // 4. Weekly / Monthly Loss Limits
  if ((settings.weekly_max_loss ?? 0) > 0 && metrics.weekPnl <= -(settings.weekly_max_loss ?? 0)) {
    warnings.push("تم الوصول إلى حد الخسارة الأسبوعي.");
    nextAction = "توقف عن التداول لنهاية الأسبوع لمراجعة خطتك";
  }
  if ((settings.monthly_max_loss ?? 0) > 0 && metrics.monthPnl <= -(settings.monthly_max_loss ?? 0)) {
    warnings.push("تم الوصول إلى حد الخسارة الشهري.");
    nextAction = "توقف عن التداول لنهاية الشهر لحماية رأس المال";
  }

  // 5. Max Daily Profit Target Hit (Protect profits)
  if (settings.max_daily_profit > 0 && metrics.todayPnl >= settings.max_daily_profit) {
    warnings.push("تم الوصول إلى الحد الأعلى للربح اليومي (حماية الأرباح من الطمع).");
    nextAction = "احمِ أرباحك وتوقف عن التداول اليوم لتجنب إعادة المكاسب للسوق";
  }

  // 6. Max Consecutive Losses
  if (settings.max_consecutive_losses > 0 && metrics.consecutiveLosses >= settings.max_consecutive_losses) {
    warnings.push(`تم بلوغ الحد الأقصى للخسائر المتتالية (${metrics.consecutiveLosses} صفقات خاسرة).`);
    nextAction = "ابدأ فترة تهدئة لمدة 30 دقيقة لكسر سلسلة الخسائر";
  }

  // 7. Max Trades per Day
  if (settings.max_trades_per_day > 0 && metrics.tradesToday >= settings.max_trades_per_day) {
    warnings.push(`تم استهلاك الحد الأقصى لعدد الصفقات اليومي (${settings.max_trades_per_day} صفقات).`);
    nextAction = "التزم بعدد الصفقات المحدد وراجع يومك دون زيادة الصفقات (Overtrading)";
  }

  // 8. Max Risk per Trade
  const maxRiskPerTrade = settings.max_risk_per_trade ?? 0;
  if (maxRiskPerTrade > 0 && tradeRisk != null && tradeRisk > maxRiskPerTrade) {
    warnings.push(`المخاطرة المحددة (${tradeRisk}) تتجاوز الحد الأقصى لكل صفقة (${maxRiskPerTrade}).`);
    nextAction = "قلّل حجم العقد (Lot size) لتتوافق المخاطرة مع حد الصفقة الواحدة";
  }

  // 9. Daily Risk Exceeded
  if (settings.max_daily_risk > 0 && tradeRisk != null && metrics.riskUsed + tradeRisk > settings.max_daily_risk) {
    warnings.push(`هذه الصفقة تتجاوز إجمالي المخاطرة اليومية المتبقية (${remainingDailyRisk ?? 0}).`);
    nextAction = "خفّض حجم المخاطرة أو انتظر إغلاق الصفقات المفتوحة";
  }
  // Unknown risk: rules 8 and 9 couldn't run, so say so instead of passing silently.
  if (tradeRisk == null && input.stop_loss) {
    warnings.push("ما قدرت أحسب مخاطرة الصفقة (ناقص الحجم أو المبلغ)، فما تأكدت إنها ضمن حدودك.");
  }

  // 10. Stop Loss Requirement (Rule requirement)
  if (input.stop_loss == null || input.stop_loss === 0) {
    warnings.push("لم يتم تحديد وقف الخسارة قبل الدخول (مخالفة لقاعدة الانضباط الأساسية).");
    nextAction = "حدد نقطة وقف الخسارة بدقة قبل إرسال الصفقة";
  }

  // 11. Active Session Check
  if (!activeSession) {
    warnings.push("لا توجد جلسة تداول نشطة بخطة محددة لليوم.");
    if (warnings.length === 0) nextAction = "ابدأ جلسة تداول وحدد خطتك اليومية أولاً";
  }

  // 12. Strategy Check
  if (!input.strategy_id || (allowedStrategyIds.length > 0 && !allowedStrategyIds.includes(input.strategy_id))) {
    warnings.push("لم يتم اختيار استراتيجية مسموحة وموثقة في النظام.");
  }

  // 13. Emotional / Greed warning
  if (isSensitive(input.emotion)) {
    warnings.push(`تم تسجيل حالة نفسية حساسة (${input.emotion}). تأكد من أن الدخول ليس بدافع الانتقام أو الطمع.`);
  }

  // 14. Checklist passed check
  if (input.checklist_passed === false) {
    warnings.push("لم تكتمل بنود قائمة التحقق قبل الدخول.");
  }

  const allowed = true;

  return {
    allowed,
    canOverride: true,
    reasons,
    warnings,
    nextAction,
    metrics: {
      tradeRisk,
      riskPercentOfBalance,
      totalOpenRisk,
      remainingDailyRisk,
      remainingTrades,
      remainingLossBeforeStop,
      remainingProfitBeforeTarget,
      rewardToRiskRatio: r2r,
    },
  };
}
