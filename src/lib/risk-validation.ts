export interface RiskSettingsInput {
  starting_balance?: number;
  daily_target?: number;
  max_daily_profit?: number;
  max_daily_loss?: number;
  max_trades_per_day?: number;
  max_risk_per_trade?: number;
  max_daily_risk?: number;
  max_consecutive_losses?: number;
  weekly_target?: number;
  weekly_max_loss?: number;
  monthly_target?: number;
  monthly_max_loss?: number;
  session_start?: string | null;
  session_end?: string | null;
  currency?: string;
}

export interface RiskValidationIssue {
  field?: keyof RiskSettingsInput;
  type: "error" | "warning";
  message: string;
}

export const SUPPORTED_CURRENCIES = ["USD", "SAR", "AED", "KWD", "EUR", "GBP", "QAR", "BHD", "OMR", "USDT"];

/**
 * Validates risk settings to catch contradictions, dangerous ratios, and illogical parameters.
 */
export function validateRiskSettings(settings: RiskSettingsInput): {
  valid: boolean;
  errors: RiskValidationIssue[];
  warnings: RiskValidationIssue[];
} {
  const errors: RiskValidationIssue[] = [];
  const warnings: RiskValidationIssue[] = [];

  const bal = Number(settings.starting_balance ?? 0);
  const dailyTarget = Number(settings.daily_target ?? 0);
  const maxProfit = Number(settings.max_daily_profit ?? 0);
  const maxLoss = Number(settings.max_daily_loss ?? 0);
  const maxTrades = Number(settings.max_trades_per_day ?? 0);
  const riskPerTrade = Number(settings.max_risk_per_trade ?? 0);
  const maxDailyRisk = Number(settings.max_daily_risk ?? 0);
  const maxStreak = Number(settings.max_consecutive_losses ?? 0);

  // 1. Balance validation
  if (bal < 0) {
    errors.push({ field: "starting_balance", type: "error", message: "الرصيد الابتدائي لا يمكن أن يكون سالباً." });
  }

  // 2. Conflict between daily target and max daily profit
  if (dailyTarget > 0 && maxProfit > 0 && dailyTarget > maxProfit) {
    errors.push({
      field: "daily_target",
      type: "error",
      message: "الهدف اليومي لا يمكن أن يكون أكبر من الحد الأعلى للربح (توقف حماية الأرباح).",
    });
  }

  // 3. Risk per trade vs Daily risk
  if (riskPerTrade > 0 && maxDailyRisk > 0 && riskPerTrade > maxDailyRisk) {
    warnings.push({
      field: "max_risk_per_trade",
      type: "warning",
      message: "المخاطرة لكل صفقة أعلى من إجمالي المخاطرة اليومية المسموحة. راجع التوافق بينهما.",
    });
  }

  // 4. Loss limit vs Balance
  if (bal > 0 && maxLoss > bal) {
    errors.push({
      field: "max_daily_loss",
      type: "error",
      message: "الحد الأقصى للخسارة اليومية أكبر من كامل رصيد الحساب.",
    });
  }

  // 5. Daily risk vs Balance
  if (bal > 0 && maxDailyRisk > bal) {
    warnings.push({
      field: "max_daily_risk",
      type: "warning",
      message: "إجمالي المخاطرة اليومية يتجاوز رصيد الحساب، وهو مستوى خطورة استثنائي.",
    });
  }

  // 6. Trades count checks
  if (settings.max_trades_per_day !== undefined && maxTrades < 0) {
    errors.push({ field: "max_trades_per_day", type: "error", message: "عدد الصفقات اليومية لا يمكن أن يكون سالباً." });
  }

  // 7. Streak count checks
  if (settings.max_consecutive_losses !== undefined && maxStreak < 0) {
    errors.push({ field: "max_consecutive_losses", type: "error", message: "الحد الأقصى للخسائر المتتالية لا يمكن أن يكون سالباً." });
  }

  // 8. Session times validity
  if (settings.session_start && settings.session_end) {
    if (settings.session_start === settings.session_end) {
      warnings.push({ field: "session_start", type: "warning", message: "وقت بداية ونهاية الجلسة متطابقان." });
    }
  }

  // 9. Currency support
  if (settings.currency) {
    const cur = settings.currency.trim().toUpperCase();
    if (!SUPPORTED_CURRENCIES.includes(cur)) {
      warnings.push({
        field: "currency",
        type: "warning",
        message: `العملة (${cur}) غير مدرجة في قائمة العملات القياسية المدعومة.`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
