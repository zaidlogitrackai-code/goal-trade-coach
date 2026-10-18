/**
 * Whether one AI action runs by itself or waits for his click — the one auto-run policy.
 * Owner decisions 3 and 4 (docs/decisions/sanad-steps.md): JOURNAL and STATE run by
 * themselves, DESTRUCTIVE always waits, and so does any STATE change that loosens his
 * protection. A trade he already placed is journaled by itself even on a NO_GO or a stopped
 * day: it is in his account already, and a card left waiting would hide it from the breaker.
 *
 * Pure — the caller loads the facts: the effective limits (dollar limits taken from
 * limits_pct on the day's anchor balance, so stale dollars on file can't pass a raise),
 * today's plan, the row the action edits, and for a trade the breaker and gate when known.
 */
import { ACTION_CLASS, isClosedUpload, type ActionClass, type ActionType } from "./agent-action-spec";
import { SURVIVAL_DEFAULTS, type BreakerResult } from "./circuit-breaker";
import { inMarkets } from "./focus";
import type { GateDecision, GateIntent } from "./pre-trade-gate";
import { safeTz } from "./trading-day";

export type PolicyAction = { type: ActionType; data: Record<string, unknown> };

/** The row an edit touches; only the fields the policy compares. */
export type PolicyTarget = {
  status?: string | null;
  direction?: string | null;
  stop_loss?: number | null;
  pnl?: number | null;
  exit_price?: number | null;
  active?: boolean | null;
  allowed?: boolean | null;
};

export type PolicyContext = {
  /** Effective settings (applyPctLimits on anchorBalance); null when none are saved yet, left out = unknown. */
  limits?: Record<string, unknown> | null;
  /** Today's daily_plans row; null when no plan was written, left out = unknown. */
  plan?: { target?: number | null; max_trades?: number | null; risk_per_trade?: number | null; max_loss?: number | null } | null;
  /** Trades opened today; null/undefined = unknown, judged as if he traded. */
  tradesToday?: number | null;
  /** update_trade / update_rule / update_strategy: the row as saved; null = not found. */
  target?: PolicyTarget | null;
  /** create_trade: closed uploads are history, open ones already placed, unless told otherwise. */
  intent?: GateIntent;
  breaker?: Pick<BreakerResult, "state" | "partial" | "preview"> | null;
  gate?: GateDecision | null;
  focusMarkets?: readonly string[] | null;
};

export type Approval = {
  class: ActionClass;
  click: boolean;
  /** Why it waits, shown on the card; null when it runs by itself. */
  reason: string | null;
  /** Ran by itself but worth saying (shown on the card and fed back to the model). */
  note: string | null;
  /** An already-placed trade on a NO_GO or a stopped day: a violation, and سَنَد asks why. */
  askReason: boolean;
};

const pos = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const EPS = 1e-9;
/** A bigger number, or 0 = switched off, is less protection — only once a value is in force. */
const raisedOrOff = (now: number, next: number) => now > 0 && (next <= 0 || next > now + EPS);
const sameNum = (a: unknown, b: unknown) => (a == null && b == null) || (a != null && b != null && Number(a) === Number(b));

/** Settings where a bigger number or 0 means less protection. */
const LIMIT_LABEL: Record<string, string> = {
  max_daily_loss: "حد الخسارة اليومي",
  weekly_max_loss: "حد الخسارة الأسبوعي",
  monthly_max_loss: "حد الخسارة الشهري",
  // The anti-greed stop: reaching it ends the day («احمِ ربحك»).
  max_daily_profit: "سقف الربح اليومي",
  max_trades_per_day: "أقصى صفقات باليوم",
  max_risk_per_trade: "مخاطرة الصفقة",
  max_daily_risk: "المخاطرة اليومية",
  max_consecutive_losses: "الخسائر المتتالية المسموحة",
  daily_target: "الهدف اليومي",
  weekly_target: "الهدف الأسبوعي",
  monthly_target: "الهدف الشهري",
};

/** What a settings patch loosens compared with the limits in force. */
export function loosenedSettings(limits: Record<string, unknown> | null | undefined, patch: Record<string, unknown>): string[] {
  // Nothing saved yet (first setup): nothing in force to loosen.
  if (!limits) return [];
  const out: string[] = [];
  for (const [k, label] of Object.entries(LIMIT_LABEL)) {
    if (!(k in patch)) continue;
    const next = pos(patch[k]);
    if (raisedOrOff(pos(limits[k]), next)) out.push(next > 0 ? `رفع ${label}` : `إلغاء ${label}`);
  }
  // A bigger balance makes every % limit bigger in dollars.
  const balance = pos(limits["starting_balance"]);
  if ("starting_balance" in patch && balance > 0 && pos(patch["starting_balance"]) > balance + EPS) out.push("رفع رصيد البداية");
  if ("cooldown_minutes" in patch && pos(patch["cooldown_minutes"]) < pos(limits["cooldown_minutes"]) - EPS) out.push("تقصير دقايق التهدئة");
  // 0 = the breaker's default, so judge the hours the breaker would really use.
  const hours = (v: unknown) => pos(v) || SURVIVAL_DEFAULTS.cooldownHours;
  if ("streak_cooldown_hours" in patch && hours(patch["streak_cooldown_hours"]) < hours(limits["streak_cooldown_hours"]) - EPS)
    out.push("تقصير التهدئة بعد الخسائر المتتالية");
  // A new zone moves "today": losses already booked can drop out of the daily limit.
  if ("timezone" in patch && patch["timezone"] !== safeTz(limits["timezone"] as string | null | undefined)) out.push("تغيير المنطقة الزمنية");
  return out;
}

const PLAN_LABEL: Record<string, string> = {
  target: "هدف خطة اليوم",
  max_trades: "صفقات خطة اليوم",
  risk_per_trade: "مخاطرة الصفقة بخطة اليوم",
  max_loss: "أقصى خسارة بخطة اليوم",
};

/** Raising today's plan after he has traded is chasing; before the first trade it is still planning. */
export function loosenedPlan(plan: PolicyContext["plan"], tradesToday: number | null | undefined, patch: Record<string, unknown>): string[] {
  if (!plan || (tradesToday != null && tradesToday <= 0)) return [];
  const out: string[] = [];
  for (const [k, label] of Object.entries(PLAN_LABEL)) {
    if (patch[k] == null) continue;
    const next = pos(patch[k]);
    if (raisedOrOff(pos((plan as Record<string, unknown>)[k]), next)) out.push(next > 0 ? `رفع ${label} بعد ما تداولت` : `إلغاء ${label} بعد ما تداولت`);
  }
  return out;
}

/** A closed trade's result, or a wider or removed stop on an open one. Unknown rows are judged strictly. */
export function loosenedTrade(t: PolicyTarget | null | undefined, patch: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (t?.status !== "open" && (["pnl", "exit_price"] as const).some((k) => patch[k] !== undefined && !sameNum(patch[k], t?.[k])))
    out.push("تعديل نتيجة صفقة مسكّرة");
  if (t?.status !== "closed" && patch["stop_loss"] !== undefined) {
    const cur = pos(t?.stop_loss);
    const next = pos(patch["stop_loss"]);
    // Setting a stop where there was none, or pulling it closer, only tightens.
    const wider = !t ? true : cur > 0 && next !== cur && (next === 0 || (t.direction === "long" ? next < cur : t.direction === "short" ? next > cur : true));
    if (wider) out.push(t && next === 0 ? "شيل وقف الخسارة" : "توسيع وقف الخسارة");
  }
  return out;
}

/** Facts the caller never loaded are judged strictly: «not looser» is never a guess. */
const UNREAD = "حدود ما قدرت أقرأها";

function loosenedBy(a: PolicyAction, ctx: PolicyContext): string[] {
  const d = a.data;
  switch (a.type) {
    case "update_settings":
      return ctx.limits === undefined ? [UNREAD] : loosenedSettings(ctx.limits, d);
    case "set_daily_plan":
      return ctx.plan === undefined ? [UNREAD] : loosenedPlan(ctx.plan, ctx.tradesToday, d);
    case "update_trade":
      return loosenedTrade(ctx.target, d);
    case "update_rule":
      return d["active"] === false && ctx.target?.active !== false ? ["إيقاف قاعدة"] : [];
    case "update_strategy":
      return d["allowed"] === true && ctx.target?.allowed !== true ? ["إرجاع استراتيجية ممنوعة"] : [];
    case "capital_move":
      return d["kind"] === "set_balance" ? ["تعديل الرصيد يدوياً"] : d["kind"] === "withdrawal" ? ["تسجيل سحب من رأس المال"] : [];
    default:
      return [];
  }
}

type Verdict = Omit<Approval, "class">;
const AUTO: Verdict = { click: false, reason: null, note: null, askReason: false };
const wait = (reason: string): Verdict => ({ click: true, reason, note: null, askReason: false });

function tradeVerdict(d: Record<string, unknown>, ctx: PolicyContext): Verdict {
  const intent = ctx.intent ?? (isClosedUpload(d as Parameters<typeof isClosedUpload>[0]) ? "historical" : "already_placed");
  if (intent === "historical" || intent === "watch") return AUTO;
  const sym = typeof d["symbol"] === "string" ? d["symbol"] : null;
  const markets = [...(ctx.focusMarkets ?? [])];
  const off = inMarkets(sym, markets) === false ? `${sym!.toUpperCase()} برّا سوقك (${markets.join("، ")})` : null;
  // Before breaker_since the breaker only warns, so a preview stop decides nothing here.
  const b = ctx.breaker;
  const stopped = !!b && !b.preview && (!!b.partial || b.state !== "TRADING_ALLOWED");
  if (intent === "pre_entry") {
    // Not in yet: a stopped day, a NO_GO or a market off his list waits. A review from blank answers doesn't.
    if (stopped) return wait("يومك موقف. لو بتدخل رغم كذا، وافق بنفسك.");
    if (ctx.gate === "NO_GO") return wait("البوابة تقول لا تدخل. لو بتدخل رغم كذا، وافق بنفسك.");
    if (off) return wait(`${off}. بدها موافقتك.`);
    return AUTO;
  }
  const noGo = stopped || ctx.gate === "NO_GO";
  const notes = [off && `${off}، انسجلت لأنها داخلة`, noGo && "دخلت رغم «لا تدخل»، سَنَد بيسألك ليش"].filter((x): x is string => !!x);
  return { click: false, reason: null, note: notes.length ? notes.join(" · ") : null, askReason: noGo };
}

/** Whether `a` waits for his click, and why. Only asked in auto mode: a click already approves. */
export function needsApproval(a: PolicyAction, ctx: PolicyContext = {}): Approval {
  const cls = ACTION_CLASS[a.type] as ActionClass | undefined;
  if (!cls) return { class: "DESTRUCTIVE", ...wait("إجراء غير معروف") };
  if (cls === "DESTRUCTIVE") return { class: cls, ...wait("الحذف يحتاج موافقتك") };
  if (a.type === "create_trade") return { class: cls, ...tradeVerdict(a.data, ctx) };
  const loose = loosenedBy(a, ctx);
  return { class: cls, ...(loose.length ? wait(`يحتاج موافقتك: ${loose.join("، ")}`) : AUTO) };
}
