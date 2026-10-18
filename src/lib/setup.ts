/** Step 0 (الإعداد): what every later gate needs, checked once. Pure. */
export type SetupState = {
  settings: {
    starting_balance?: unknown; timezone?: string | null; limits_accepted_at?: string | null;
    max_daily_loss?: unknown; max_risk_per_trade?: unknown; max_trades_per_day?: unknown;
  } | null;
  strategies: readonly { name: string; allowed: boolean; entry_conditions: string | null; exit_conditions: string | null; description?: string | null }[];
  rules: readonly { active: boolean }[];
  /** The live balance from the capital ledger, when known. */
  balance?: number | null | undefined;
};

/** The one-tap starter strategy: a placeholder, not his own written system. */
export const STRATEGY_TEMPLATE_NAME = "استراتيجية تجريبية";

const STOP_RE = /ستوب|وقف|stop|\bsl\b/i;

function validTz(tz: string | null | undefined): boolean {
  if (!tz) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
}

/** A strategy counts only with written entry conditions and a stop rule. */
export function strategyReady(s: SetupState["strategies"][number]): boolean {
  if (!s.allowed || s.name.trim() === STRATEGY_TEMPLATE_NAME) return false;
  if (!s.entry_conditions?.trim()) return false;
  return STOP_RE.test(`${s.exit_conditions ?? ""} ${s.entry_conditions} ${s.description ?? ""}`);
}

/** What is still missing, in his words; empty when setup is complete. Session hours are optional. */
export function setupMissing(st: SetupState): string[] {
  const s = st.settings;
  const out: string[] = [];
  const bal = Number(st.balance ?? s?.starting_balance) || 0;
  if (!(bal > 0)) out.push("رصيدك");
  const limitsSet = !!s?.limits_accepted_at
    || (Number(s?.max_daily_loss) > 0 && Number(s?.max_risk_per_trade) > 0 && Number(s?.max_trades_per_day) > 0);
  if (!limitsSet) out.push("حدودك اليومية");
  if (!st.strategies.some(strategyReady)) out.push("استراتيجية فيها شروط دخول وقاعدة ستوب");
  if (!st.rules.some((r) => r.active)) out.push("قاعدة وحدة على الأقل");
  if (!validTz(s?.timezone)) out.push("منطقتك الزمنية");
  return out;
}

export const setupComplete = (st: SetupState) => setupMissing(st).length === 0;
