/**
 * Unified risk-limit model (Phase 1).
 *
 * The database keeps the original column names; this module is the single
 * place that maps them to the product vocabulary, validates them, and does
 * the per-trade risk arithmetic. Pages and the trade gate import from here
 * instead of re-implementing the math.
 *
 * Convention kept from the existing app: a limit of 0 means "not enabled".
 */

export const SUPPORTED_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "SAR",
  "AED",
  "KWD",
  "QAR",
  "BHD",
  "OMR",
  "EGP",
  "JPY",
  "CHF",
  "CAD",
  "AUD",
] as const;

/** Product name → database column. */
export const RISK_FIELD_MAP = {
  starting_balance: "starting_balance",
  profit_target_daily: "daily_target",
  profit_stop_daily: "max_daily_profit",
  loss_limit_daily: "max_daily_loss",
  max_trades_daily: "max_trades_per_day",
  max_risk_per_trade: "max_risk_per_trade",
  max_total_open_risk_daily: "max_daily_risk",
  max_consecutive_losses: "max_consecutive_losses",
  profit_target_weekly: "weekly_target",
  loss_limit_weekly: "weekly_max_loss",
  profit_target_monthly: "monthly_target",
  loss_limit_monthly: "monthly_max_loss",
  trading_start_time: "session_start",
  trading_end_time: "session_end",
  currency: "currency",
  timezone: "timezone",
} as const;

export interface RiskSettingsRow {
  starting_balance: number;
  daily_target: number;
  max_daily_profit: number;
  max_daily_loss: number;
  max_trades_per_day: number;
  max_risk_per_trade: number;
  max_daily_risk: number;
  max_consecutive_losses: number;
  weekly_target?: number;
  weekly_max_loss?: number;
  monthly_target?: number;
  monthly_max_loss?: number;
  session_start?: string | null;
  session_end?: string | null;
  currency?: string | null;
  timezone?: string | null;
}

export type IssueSeverity = "error" | "warning";
export interface RiskIssue {
  field: keyof RiskSettingsRow;
  severity: IssueSeverity;
  message: string;
}

const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/**
 * Validates a full settings row. `error` issues must block saving;
 * `warning` issues are shown but do not block.
 */
export function validateRiskLimits(s: RiskSettingsRow): RiskIssue[] {
  const issues: RiskIssue[] = [];
  const add = (field: keyof RiskSettingsRow, severity: IssueSeverity, message: string) =>
    issues.push({ field, severity, message });

  const numeric: (keyof RiskSettingsRow)[] = [
    "starting_balance",
    "daily_target",
    "max_daily_profit",
    "max_daily_loss",
    "max_trades_per_day",
    "max_risk_per_trade",
    "max_daily_risk",
    "max_consecutive_losses",
    "weekly_target",
    "weekly_max_loss",
    "monthly_target",
    "monthly_max_loss",
  ];
  for (const k of numeric) {
    const v = n(s[k]);
    if (!Number.isFinite(v)) add(k, "error", "القيمة يجب أن تكون رقمًا.");
    else if (v < 0) add(k, "error", "القيمة لا يمكن أن تكون سالبة. استخدم 0 لإلغاء تفعيل الحد.");
  }
  for (const k of ["max_trades_per_day", "max_consecutive_losses"] as const) {
    const v = n(s[k]);
    if (Number.isFinite(v) && !Number.isInteger(v)) add(k, "error", "يجب أن يكون عددًا صحيحًا.");
  }

  const bal = n(s.starting_balance);
  const target = n(s.daily_target);
  const stop = n(s.max_daily_profit);
  const loss = n(s.max_daily_loss);
  const perTrade = n(s.max_risk_per_trade);
  const daily = n(s.max_daily_risk);

  if (target > 0 && stop > 0 && target > stop)
    add(
      "daily_target",
      "error",
      "الهدف اليومي أعلى من حد إيقاف الربح، فسيتوقف التداول قبل الوصول للهدف. اجعل الهدف أقل من حد الإيقاف أو مساويًا له.",
    );
  if (perTrade > 0 && daily > 0 && perTrade > daily)
    add(
      "max_risk_per_trade",
      "error",
      "المخاطرة لكل صفقة أعلى من المخاطرة اليومية، فصفقة واحدة ستتجاوز حد اليوم.",
    );
  if (perTrade > 0 && loss > 0 && perTrade > loss)
    add(
      "max_risk_per_trade",
      "warning",
      "المخاطرة لكل صفقة أعلى من حد الخسارة اليومية؛ خسارة صفقة واحدة توقف يومك.",
    );

  if (bal > 0) {
    if (loss > bal) add("max_daily_loss", "error", "حد الخسارة اليومية أكبر من رصيد الحساب.");
    if (perTrade > bal)
      add("max_risk_per_trade", "error", "المخاطرة لكل صفقة أكبر من رصيد الحساب.");
    if (daily > bal) add("max_daily_risk", "error", "المخاطرة اليومية أكبر من رصيد الحساب.");
    if (n(s.weekly_max_loss) > bal)
      add("weekly_max_loss", "error", "حد الخسارة الأسبوعية أكبر من رصيد الحساب.");
    if (n(s.monthly_max_loss) > bal)
      add("monthly_max_loss", "error", "حد الخسارة الشهرية أكبر من رصيد الحساب.");
    if (perTrade > bal * 0.05 && perTrade <= bal)
      add(
        "max_risk_per_trade",
        "warning",
        `المخاطرة لكل صفقة تساوي ${pct(perTrade / bal)} من الرصيد، وهي نسبة مرتفعة.`,
      );
  } else {
    add("starting_balance", "warning", "لم يتم تحديد الرصيد، فلن تظهر نسبة المخاطرة من الرصيد.");
  }

  const wLoss = n(s.weekly_max_loss);
  const mLoss = n(s.monthly_max_loss);
  if (loss > 0 && wLoss > 0 && wLoss < loss)
    add("weekly_max_loss", "warning", "حد الخسارة الأسبوعية أقل من حد الخسارة اليومية.");
  if (wLoss > 0 && mLoss > 0 && mLoss < wLoss)
    add("monthly_max_loss", "warning", "حد الخسارة الشهرية أقل من حد الخسارة الأسبوعية.");

  if (loss === 0)
    add(
      "max_daily_loss",
      "warning",
      "حد الخسارة اليومية غير مفعّل. يُنصح بتحديده لحماية رأس المال.",
    );
  if (n(s.max_trades_per_day) === 0)
    add("max_trades_per_day", "warning", "عدد الصفقات اليومي غير محدود.");
  if (perTrade === 0) add("max_risk_per_trade", "warning", "المخاطرة لكل صفقة غير محددة.");

  const start = s.session_start ?? "";
  const end = s.session_end ?? "";
  if (start && !TIME_RE.test(start)) add("session_start", "error", "وقت البداية غير صالح.");
  if (end && !TIME_RE.test(end)) add("session_end", "error", "وقت النهاية غير صالح.");
  if ((start && !end) || (!start && end))
    add("session_end", "error", "حدد وقت البداية والنهاية معًا أو اتركهما فارغين.");
  if (start && end && start.slice(0, 5) === end.slice(0, 5))
    add("session_end", "error", "وقت البداية ووقت النهاية متطابقان.");

  const cur = (s.currency ?? "").toUpperCase();
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(cur))
    add("currency", "error", `العملة غير مدعومة. اختر من: ${SUPPORTED_CURRENCIES.join("، ")}.`);

  return issues;
}

export const hasBlockingIssues = (issues: RiskIssue[]) =>
  issues.some((i) => i.severity === "error");

/** The issues that contradict each other (used by the dashboard "needs review" banner). */
export function conflictIssues(s: RiskSettingsRow): RiskIssue[] {
  return validateRiskLimits(s).filter((i) => i.severity === "error");
}

export function pct(ratio: number) {
  return `${(Math.round(ratio * 1000) / 10).toLocaleString("en-US")}%`;
}

// ---------------------------------------------------------------------------
// Per-trade arithmetic
// ---------------------------------------------------------------------------

export interface TradeDraftNumbers {
  direction: "long" | "short" | string;
  entry?: number | null | undefined;
  stop?: number | null | undefined;
  target?: number | null | undefined;
  size?: number | null | undefined;
  /** Risk amount the user typed. Used when price-based loss cannot be computed. */
  riskInput?: number | null | undefined;
}

export interface TradeRiskCalc {
  /** Loss if the stop is hit (positive number), or null when unknown. */
  potentialLoss: number | null;
  /** Profit if the target is hit, or null when unknown. */
  potentialProfit: number | null;
  /** Reward ÷ risk, null when either side is unknown. */
  rr: number | null;
  /** The amount the gate treats as this trade's risk. */
  risk: number | null;
  riskSource: "prices" | "input" | null;
  /** Share of balance at risk (0..1), null when balance or risk is unknown. */
  riskOfBalance: number | null;
  /** Structural problems with the prices (stop on the wrong side, etc.). */
  problems: string[];
  /** Non-blocking notes, e.g. the typed risk differs from the price-based risk. */
  notes: string[];
}

const fin = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * Computes the trade's risk from entry/stop/size when possible; falls back to
 * the typed risk amount. Never guesses: a missing input yields null.
 */
export function calcTradeRisk(d: TradeDraftNumbers, balance: number): TradeRiskCalc {
  const problems: string[] = [];
  const long = d.direction !== "short";
  let potentialLoss: number | null = null;
  let potentialProfit: number | null = null;

  if (fin(d.entry) && fin(d.stop)) {
    if (long ? d.stop >= d.entry : d.stop <= d.entry)
      problems.push(
        long
          ? "وقف الخسارة يجب أن يكون أقل من سعر الدخول في صفقة الشراء."
          : "وقف الخسارة يجب أن يكون أعلى من سعر الدخول في صفقة البيع.",
      );
    else if (fin(d.size) && d.size > 0) potentialLoss = Math.abs(d.entry - d.stop) * d.size;
  }
  if (fin(d.entry) && fin(d.target)) {
    if (long ? d.target <= d.entry : d.target >= d.entry)
      problems.push(
        long
          ? "الهدف يجب أن يكون أعلى من سعر الدخول في صفقة الشراء."
          : "الهدف يجب أن يكون أقل من سعر الدخول في صفقة البيع.",
      );
    else if (fin(d.size) && d.size > 0) potentialProfit = Math.abs(d.target - d.entry) * d.size;
  }
  if (fin(d.riskInput) && d.riskInput < 0) problems.push("مبلغ المخاطرة لا يمكن أن يكون سالبًا.");

  const notes: string[] = [];
  let risk: number | null = null;
  let riskSource: TradeRiskCalc["riskSource"] = null;
  const typed = fin(d.riskInput) && d.riskInput > 0 ? d.riskInput : null;
  if (potentialLoss != null) {
    // Conservative: when both exist, the larger amount is the risk.
    risk = typed != null ? Math.max(potentialLoss, typed) : potentialLoss;
    riskSource = typed != null && typed > potentialLoss ? "input" : "prices";
    if (typed != null && Math.abs(typed - potentialLoss) > Math.max(0.01, potentialLoss * 0.05))
      notes.push(
        `مبلغ المخاطرة المكتوب يختلف عن المحسوب من الأسعار (${Math.round(potentialLoss * 100) / 100}). تم اعتماد الأعلى.`,
      );
  } else if (typed != null) {
    risk = typed;
    riskSource = "input";
  }

  // R:R from prices when size is unknown (ratio does not need size).
  let rr: number | null = null;
  if (potentialLoss != null && potentialProfit != null && potentialLoss > 0)
    rr = potentialProfit / potentialLoss;
  else if (
    problems.length === 0 &&
    fin(d.entry) &&
    fin(d.stop) &&
    fin(d.target) &&
    d.entry !== d.stop
  )
    rr = Math.abs(d.target - d.entry) / Math.abs(d.entry - d.stop);

  const round = (x: number | null) => (x == null ? null : Math.round(x * 100) / 100);
  return {
    potentialLoss: round(potentialLoss),
    potentialProfit: round(potentialProfit),
    rr: rr == null ? null : Math.round(rr * 100) / 100,
    risk: round(risk),
    riskSource,
    riskOfBalance: risk != null && balance > 0 ? risk / balance : null,
    problems,
    notes,
  };
}
