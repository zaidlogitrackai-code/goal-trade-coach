/**
 * The one validator for risk settings: the limits form, the limits summary and
 * سَنَد's update_settings all ask it. `errors` block a save, `warnings` are shown,
 * `notes` say what was normalised (USDT is booked as USD). A limit of 0 means "off",
 * and a key that is null, undefined or '' was not given, so it is never checked.
 */
export interface RiskSettingsInput {
  starting_balance?: number | null;
  daily_target?: number | null;
  max_daily_profit?: number | null;
  max_daily_loss?: number | null;
  max_trades_per_day?: number | null;
  max_risk_per_trade?: number | null;
  max_daily_risk?: number | null;
  max_consecutive_losses?: number | null;
  weekly_target?: number | null;
  weekly_max_loss?: number | null;
  monthly_target?: number | null;
  monthly_max_loss?: number | null;
  cooldown_minutes?: number | null;
  session_start?: string | null;
  session_end?: string | null;
  currency?: string | null;
}

export interface RiskValidationIssue {
  field?: keyof RiskSettingsInput;
  type: "error" | "warning";
  message: string;
}

export interface RiskValidation {
  valid: boolean;
  errors: RiskValidationIssue[];
  warnings: RiskValidationIssue[];
  notes: string[];
}

/** ISO-4217 codes the app accepts. Gulf and Levant first: the form lists the first five. */
export const SUPPORTED_CURRENCIES = [
  "USD", "SAR", "AED", "KWD", "QAR", "BHD", "OMR", "JOD", "EGP",
  "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "TRY",
] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

// Not ISO codes, but what a trader types for a dollar account.
const DOLLAR_ALIASES = ["$", "دولار", "USDT", "USDC"];
const STABLECOINS = ["USDT", "USDC"];

const isCurrency = (c: string): c is Currency => (SUPPORTED_CURRENCIES as readonly string[]).includes(c);

/** The ISO code for what was typed, or null when it isn't one; a stablecoin maps to USD with a note. */
export function normalizeCurrency(raw: string | null | undefined): { code: Currency | null; note: string | null } {
  const t = (raw ?? "").trim().toUpperCase();
  if (isCurrency(t)) return { code: t, note: null };
  if (DOLLAR_ALIASES.includes(t))
    return { code: "USD", note: STABLECOINS.includes(t) ? `${t} تنحسب دولار (USD): نفس القيمة، والأرقام تطلع بالدولار.` : null };
  return { code: null, note: null };
}

/** "9:00", "09:00" or the database's "09:00:00" → "09:00"; anything else → null. */
export function parseClock(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  const m = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/.exec(t);
  if (!m || Number(m[1]) > 23) return null;
  return `${m[1]!.padStart(2, "0")}:${m[2]}`;
}

const LABEL: Record<Exclude<keyof RiskSettingsInput, "session_start" | "session_end" | "currency">, string> = {
  starting_balance: "الرصيد",
  daily_target: "الهدف اليومي",
  max_daily_profit: "سقف الربح اليومي",
  max_daily_loss: "حد الخسارة اليومي",
  max_trades_per_day: "عدد الصفقات باليوم",
  max_risk_per_trade: "مخاطرة الصفقة",
  max_daily_risk: "المخاطرة اليومية",
  max_consecutive_losses: "الخسائر المتتالية",
  weekly_target: "الهدف الأسبوعي",
  weekly_max_loss: "حد الخسارة الأسبوعي",
  monthly_target: "الهدف الشهري",
  monthly_max_loss: "حد الخسارة الشهري",
  cooldown_minutes: "مدة التهدئة",
};
const NUMERIC = Object.keys(LABEL) as (keyof typeof LABEL)[];
const INTEGER: (keyof typeof LABEL)[] = ["max_trades_per_day", "max_consecutive_losses"];

const blank = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "");

export function validateRiskSettings(settings: RiskSettingsInput): RiskValidation {
  const errors: RiskValidationIssue[] = [];
  const warnings: RiskValidationIssue[] = [];
  const notes: string[] = [];
  const error = (field: keyof RiskSettingsInput, message: string) => errors.push({ field, type: "error", message });
  const warn = (field: keyof RiskSettingsInput, message: string) => warnings.push({ field, type: "warning", message });

  // Only a finite, non-negative number takes part in the cross-checks below.
  const val: Partial<Record<keyof typeof LABEL, number>> = {};
  for (const k of NUMERIC) {
    const raw = settings[k];
    if (blank(raw)) continue;
    const v = Number(raw);
    if (!Number.isFinite(v)) error(k, `${LABEL[k]}: لازم يكون رقم.`);
    else if (v < 0) error(k, `${LABEL[k]} ما ينفع بالسالب. حط 0 إذا تبي تلغي الحد.`);
    else if (INTEGER.includes(k) && !Number.isInteger(v)) error(k, `${LABEL[k]} لازم يكون عدد صحيح.`);
    else val[k] = v;
  }
  const n = (k: keyof typeof LABEL) => val[k] ?? 0;

  const bal = n("starting_balance");
  const dailyTarget = n("daily_target");
  const maxProfit = n("max_daily_profit");
  const riskPerTrade = n("max_risk_per_trade");
  const maxDailyRisk = n("max_daily_risk");

  if (dailyTarget > 0 && maxProfit > 0 && dailyTarget > maxProfit)
    error("daily_target", "الهدف اليومي لا يمكن أن يكون أكبر من الحد الأعلى للربح (توقف حماية الأرباح).");

  if (riskPerTrade > 0 && maxDailyRisk > 0 && riskPerTrade > maxDailyRisk)
    warn("max_risk_per_trade", "المخاطرة لكل صفقة أعلى من إجمالي المخاطرة اليومية المسموحة. راجع التوافق بينهما.");

  // A bigger period must allow at least as much as a smaller one, or one bad day stops the week.
  // No numbers in these messages: a fix that tightens one side keeps the same message, so it isn't "new".
  const chain = (keys: (keyof typeof LABEL)[], report: (k: keyof typeof LABEL, msg: string) => void, tail: string) => {
    const on = keys.filter((k) => n(k) > 0);
    for (let i = 1; i < on.length; i++) {
      const small = on[i - 1]!;
      const big = on[i]!;
      if (n(big) < n(small)) report(big, `${LABEL[big]} أقل من ${LABEL[small]}، ${tail}`);
    }
  };
  chain(["max_daily_loss", "weekly_max_loss", "monthly_max_loss"], error, "فالحد الأصغر ما له معنى. خلّ الأطول أكبر أو يساويه.");
  chain(["daily_target", "weekly_target", "monthly_target"], warn, "راجعهم: هدف الفترة الأطول المفروض أكبر.");

  if (bal > 0) {
    for (const k of ["max_daily_loss", "weekly_max_loss", "monthly_max_loss", "max_risk_per_trade"] as const)
      if (n(k) > bal) error(k, `${LABEL[k]} أكبر من كامل رصيد الحساب.`);
    if (maxDailyRisk > bal)
      warn("max_daily_risk", "إجمالي المخاطرة اليومية يتجاوز رصيد الحساب، وهو مستوى خطورة استثنائي.");
  }

  // Session hours: both or neither. Start after end is a session over midnight, which the gate supports.
  const startRaw = settings.session_start;
  const endRaw = settings.session_end;
  const start = parseClock(startRaw);
  const end = parseClock(endRaw);
  if (!blank(startRaw) && !start) error("session_start", "وقت بداية الجلسة مو صحيح، اكتبه مثل 09:00.");
  if (!blank(endRaw) && !end) error("session_end", "وقت نهاية الجلسة مو صحيح، اكتبه مثل 17:00.");
  if (blank(startRaw) !== blank(endRaw))
    error("session_end", "حدد بداية الجلسة ونهايتها مع بعض، أو خلّهم فاضيين.");
  if (start && end && start === end) error("session_end", "بداية الجلسة ونهايتها نفس الوقت.");
  if (start && end && start > end) warn("session_end", `جلستك تعدّي منتصف الليل: من ${start} لين ${end}.`);

  if (!blank(settings.currency)) {
    const c = normalizeCurrency(settings.currency);
    if (!c.code)
      error("currency", `العملة (${String(settings.currency).trim().toUpperCase()}) مو رمز ISO معروف. اكتبها بثلاث حروف مثل USD أو SAR.`);
    else if (c.note) notes.push(c.note);
  }

  return { valid: errors.length === 0, errors, warnings, notes };
}
