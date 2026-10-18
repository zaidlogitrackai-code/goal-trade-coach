/**
 * What سَنَد and المحلل may propose: the action types, their zod schemas and labels, the
 * class of each one and which agent mode may use which. Pure, no browser imports — the
 * server builds the model's schema and screens replies with it, the browser runs the
 * actions (agent-actions.ts) and asks action-policy.ts whether one waits for a click.
 */
import { z } from "zod";
import { normalizeCurrency, parseClock, SUPPORTED_CURRENCIES } from "./risk-validation";
import { safeTz } from "./trading-day";

export type AgentAction = { type: ActionType; summary: string; data: string };
export const ACTION_TYPES = [
  "update_settings",
  "add_strategy",
  "update_strategy",
  "delete_strategy",
  "add_rule",
  "update_rule",
  "delete_rule",
  "create_trade",
  "close_trade",
  "update_trade",
  "delete_trade",
  "add_note",
  "delete_note",
  "start_session",
  "end_session",
  "start_cooldown",
  "mark_notifications_read",
  "update_focus",
  "set_guard_style",
  "capital_move",
  "save_analysis",
  "delete_analysis",
  "delete_thread",
  "add_reminder",
  "delete_reminder",
  "set_daily_plan",
  "attach_trade_image",
  "remove_trade_image",
  "add_violation",
  "delete_violation",
  "delete_daily_plan",
  "update_session",
  "delete_session",
  "rename_thread",
  "add_strategy_example",
  "delete_strategy_example",
  "delete_notifications",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const ACTION_LABEL: Record<ActionType, string> = {
  update_settings: "تعديل الحدود والأهداف",
  add_strategy: "إضافة استراتيجية",
  update_strategy: "تعديل استراتيجية",
  delete_strategy: "حذف استراتيجية",
  add_rule: "إضافة قاعدة",
  update_rule: "تعديل قاعدة",
  delete_rule: "حذف قاعدة",
  create_trade: "تسجيل صفقة",
  close_trade: "إغلاق صفقة",
  update_trade: "تعديل صفقة",
  delete_trade: "حذف صفقة",
  add_note: "إضافة ملاحظة للمعرفة",
  delete_note: "حذف ملاحظة",
  start_session: "بدء جلسة تداول",
  end_session: "إنهاء الجلسة",
  start_cooldown: "بدء فترة تهدئة",
  mark_notifications_read: "تعليم الإشعارات كمقروءة",
  update_focus: "تحديث ملف التركيز",
  set_guard_style: "تحديث طريقة حارس الانضباط",
  capital_move: "حركة على رأس المال",
  save_analysis: "حفظ تحليل شارت",
  delete_analysis: "حذف تحليل",
  delete_thread: "حذف محادثة",
  add_reminder: "إضافة تذكير",
  delete_reminder: "حذف تذكير",
  set_daily_plan: "خطة اليوم",
  attach_trade_image: "إرفاق صورة بالصفقة",
  remove_trade_image: "حذف صورة الصفقة",
  add_violation: "تسجيل مخالفة",
  delete_violation: "حذف مخالفة",
  delete_daily_plan: "مسح خطة اليوم",
  update_session: "تعديل جلسة",
  delete_session: "حذف جلسة",
  rename_thread: "تغيير اسم محادثة",
  add_strategy_example: "حفظ مثال تدريب",
  delete_strategy_example: "حذف مثال تدريب",
  delete_notifications: "إخفاء التنبيهات",
};

/**
 * JOURNAL records what happened or what was said; STATE changes how the system judges him
 * (limits, plan, rules, strategies, focus, capital, a trade's numbers); DESTRUCTIVE removes
 * or hides something. JOURNAL and STATE run by themselves, except a STATE change that
 * loosens his protection; DESTRUCTIVE always waits for its own click (owner decision 3).
 */
export type ActionClass = "JOURNAL" | "STATE" | "DESTRUCTIVE";
export const ACTION_CLASS: Record<ActionType, ActionClass> = {
  update_settings: "STATE",
  add_strategy: "STATE",
  update_strategy: "STATE",
  delete_strategy: "DESTRUCTIVE",
  add_rule: "STATE",
  update_rule: "STATE",
  delete_rule: "DESTRUCTIVE",
  create_trade: "JOURNAL",
  close_trade: "JOURNAL",
  update_trade: "STATE",
  delete_trade: "DESTRUCTIVE",
  add_note: "JOURNAL",
  delete_note: "DESTRUCTIVE",
  start_session: "JOURNAL",
  end_session: "JOURNAL",
  start_cooldown: "STATE",
  mark_notifications_read: "JOURNAL",
  update_focus: "STATE",
  set_guard_style: "STATE",
  capital_move: "STATE",
  save_analysis: "JOURNAL",
  delete_analysis: "DESTRUCTIVE",
  delete_thread: "DESTRUCTIVE",
  add_reminder: "STATE",
  delete_reminder: "DESTRUCTIVE",
  set_daily_plan: "STATE",
  attach_trade_image: "JOURNAL",
  remove_trade_image: "DESTRUCTIVE",
  add_violation: "JOURNAL",
  delete_violation: "DESTRUCTIVE",
  delete_daily_plan: "DESTRUCTIVE",
  update_session: "JOURNAL",
  delete_session: "DESTRUCTIVE",
  rename_thread: "JOURNAL",
  // Every agent judges his trades by these examples.
  add_strategy_example: "STATE",
  delete_strategy_example: "DESTRUCTIVE",
  // Hiding notifications is still a removal from his view: it waits like a delete.
  delete_notifications: "DESTRUCTIVE",
};

/** Always wait for an explicit click, even in auto mode, and never join «وافق على الكل». */
export const DESTRUCTIVE: readonly ActionType[] = ACTION_TYPES.filter((t) => ACTION_CLASS[t] === "DESTRUCTIVE");
export const isDestructive = (t: string) => (DESTRUCTIVE as readonly string[]).includes(t);

/**
 * analyst: المحلل's analysis tools (create_trade stays until send_to_gate replaces it).
 * setup: the first-run interview — limits, one strategy, rules, focus.
 * manager: the system thread (نظامي › إدارة النظام): his setup and everything it shapes.
 * day: سَنَد's day thread, the full set (risk, discipline and strategy are its modes).
 */
export const AGENT_MODES = ["analyst", "setup", "day", "manager"] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

const SETUP_ACTIONS = ["update_settings", "add_strategy", "add_rule", "update_focus"] as const satisfies readonly ActionType[];
const MODE_ACTIONS: Record<AgentMode, readonly ActionType[]> = {
  analyst: ["save_analysis", "add_strategy_example", "attach_trade_image", "create_trade"],
  setup: SETUP_ACTIONS,
  manager: [
    ...SETUP_ACTIONS,
    "update_strategy",
    "delete_strategy",
    "update_rule",
    "delete_rule",
    "set_guard_style",
    "capital_move",
    "add_note",
    "delete_note",
    "add_strategy_example",
    "delete_strategy_example",
    "add_reminder",
    "delete_reminder",
    "mark_notifications_read",
    "delete_notifications",
  ],
  day: ACTION_TYPES,
};

/** The action types a mode may propose, in ACTION_TYPES order. */
export function allowedActions(mode: AgentMode): ActionType[] {
  const own = new Set<ActionType>(MODE_ACTIONS[mode]);
  return ACTION_TYPES.filter((t) => own.has(t));
}

/** The chat pages' modes: the analyst page is المحلل, every other chat is سَنَد's day. */
export function agentModeFor(chatMode: string | null | undefined): AgentMode {
  return chatMode === "analyst" ? "analyst" : "day";
}

/**
 * The model's actions as the server keeps them: only types its mode allows, in the stored
 * shape. Bad data is kept on purpose — the card shows the Arabic issue and nothing runs.
 */
export function screenActions(raw: unknown, mode: AgentMode, max = 30): { actions: AgentAction[]; dropped: string[] } {
  const allowed = new Set<string>(allowedActions(mode));
  const actions: AgentAction[] = [];
  const dropped: string[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const type = typeof o["type"] === "string" ? o["type"] : "";
    if (!allowed.has(type) || typeof o["data"] !== "string") {
      dropped.push(type || "?");
      continue;
    }
    if (actions.length >= max) break;
    actions.push({ type: type as ActionType, summary: typeof o["summary"] === "string" ? o["summary"].slice(0, 300) : "", data: o["data"] });
  }
  return { actions, dropped };
}

const num = z.coerce.number().finite();
const opt = z.string().max(2000).nullish();

// Every agent learns from these examples, so a guessed verdict would teach the
// opposite rule. Anything that is not clearly right or wrong is refused.
const VERDICTS: Record<string, "good" | "bad"> = {
  صح: "good",
  صحيح: "good",
  good: "good",
  غلط: "bad",
  خطأ: "bad",
  bad: "bad",
};
export const VERDICT_MSG = "حدد: صح أو غلط؟";

/**
 * A trade from the AI is finished only when it says closed or has an exit price.
 * An MT5 Trade-tab screenshot shows floating P&L on open positions, and booking
 * that as a close would record a fake result and drop the trade from the breaker.
 * An explicit "open" wins, because that tab also shows a current price.
 */
export function isClosedUpload(t: {
  status?: string | null | undefined;
  exit_price?: number | null | undefined;
  /** Read but never decisive: floating P&L looks exactly like a result. */
  pnl?: number | null | undefined;
}): boolean {
  if (t.status === "open") return false;
  return t.status === "closed" || t.exit_price != null;
}

const SETTINGS_KEYS = [
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
  "cooldown_minutes",
  "streak_cooldown_hours",
] as const;

/** سَنَد sends null or "" for "not mentioned"; coerced, both became 0 = that limit switched off. */
const dropBlank = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).filter(([, x]) => x != null && !(typeof x === "string" && x.trim() === "")))
    : v;
const clock = (msg: string) =>
  z.preprocess((v) => (typeof v === "string" ? (parseClock(v) ?? v) : v), z.string().refine((t) => parseClock(t) === t, msg));

export const SCHEMAS = {
  update_settings: z.preprocess(
    dropBlank,
    z
      .object({
        ...Object.fromEntries(SETTINGS_KEYS.map((k) => [k, num.min(0).optional()])),
        // USDT and friends are booked as USD; anything else must be a real ISO code.
        currency: z
          .preprocess(
            (v) => (typeof v === "string" ? (normalizeCurrency(v).code ?? v) : v),
            z.enum(SUPPORTED_CURRENCIES, { message: "العملة لازم تكون رمز ISO مثل USD أو SAR" }),
          )
          .optional(),
        display_name: z.string().max(60).optional(),
        timezone: z.string().max(64).refine((tz) => safeTz(tz) === tz, "منطقة زمنية غير معروفة").optional(),
        session_start: clock("وقت بداية الجلسة لازم يكون مثل 09:00").optional(),
        session_end: clock("وقت نهاية الجلسة لازم يكون مثل 17:00").optional(),
      })
      .partial(),
  ),
  add_strategy: z.object({
    name: z.string().min(1).max(80),
    description: opt,
    entry_conditions: opt,
    exit_conditions: opt,
    markets: opt,
    timeframes: opt,
  }),
  add_rule: z.object({ title: z.string().min(1).max(200), description: opt }),
  create_trade: z.object({
    symbol: z.string().max(20).nullish(),
    direction: z.enum(["long", "short"]).catch("long"),
    entry_price: num.nullish(),
    stop_loss: num.nullish(),
    take_profit: num.nullish(),
    position_size: num.nullish(),
    risk_amount: num.min(0).nullish(),
    strategy: z.string().nullish(),
    emotion: z.string().max(20).nullish(),
    notes: opt,
    // A garbled status counts as unknown, so the exit price decides (isClosedUpload).
    status: z.enum(["open", "closed"]).optional().catch(undefined),
    pnl: num.nullish(),
    exit_price: num.nullish(),
    opened_at: z.string().max(40).nullish(),
  }),
  save_analysis: z.object({
    symbol: z.string().max(20).nullish(),
    timeframe: z.string().max(20).nullish(),
    question: opt,
    result: z.string().min(1).max(8000),
  }),
  delete_analysis: z.object({ id: z.string().uuid().nullish(), symbol: z.string().max(20).nullish() }),
  delete_thread: z.object({ title: z.string().min(1).max(200) }),
  add_reminder: z.object({
    title: z.string().min(1).max(120),
    body: z.string().max(500).nullish(),
    repeat: z.enum(["once", "daily"]).nullish(),
    at: z.string().regex(/^\d{1,2}:\d{2}$/).nullish(),
    in_minutes: z.coerce.number().int().min(1).max(10080).nullish(),
  }),
  delete_reminder: z.object({ title: z.string().min(1).max(120) }),
  set_daily_plan: z.object({
    target: num.min(0).nullish(),
    max_trades: z.coerce.number().int().min(0).max(100).nullish(),
    risk_per_trade: num.min(0).nullish(),
    max_loss: num.min(0).nullish(),
    note: z.string().max(500).nullish(),
  }),
  close_trade: z.object({
    symbol: z.string().max(20).nullish(),
    pnl: num,
    exit_price: num.nullish(),
    notes: opt,
  }),
  add_note: z.object({
    title: z.string().min(1).max(200),
    content: z.string().max(5000).default(""),
    category: z.string().max(40).default("عام"),
  }),
  update_strategy: z.object({
    name: z.string().min(1).max(80),
    new_name: z.string().min(1).max(80).nullish(),
    description: opt,
    entry_conditions: opt,
    exit_conditions: opt,
    markets: opt,
    timeframes: opt,
    allowed: z.boolean().nullish(),
  }),
  delete_strategy: z.object({ name: z.string().min(1).max(80) }),
  add_strategy_example: z.object({
    verdict: z.preprocess(
      (v) => (typeof v === "string" ? (VERDICTS[v.trim().toLowerCase()] ?? v) : v),
      z.enum(["good", "bad"], { message: VERDICT_MSG }),
    ),
    reason: z.string().min(1).max(1000),
    strategy: z.string().max(80).nullish(),
    symbol: z.string().max(20).nullish(),
    timeframe: z.string().max(10).nullish(),
    with_image: z.boolean().nullish(),
  }),
  delete_strategy_example: z.object({ id: z.string().uuid() }),
  update_rule: z.object({
    title: z.string().min(1).max(200),
    new_title: z.string().min(1).max(200).nullish(),
    description: opt,
    active: z.boolean().nullish(),
  }),
  delete_rule: z.object({ title: z.string().min(1).max(200) }),
  update_trade: z
    .object({
      trade_id: z.string().uuid().nullish(),
      symbol: z.string().max(20).nullish(),
      entry_price: num.nullish(),
      stop_loss: num.nullish(),
      take_profit: num.nullish(),
      position_size: num.nullish(),
      emotion: z.string().max(20).nullish(),
      notes: opt,
      close_notes: opt,
      strategy: z.string().nullish(),
      pnl: num.nullish(),
      exit_price: num.nullish(),
    })
    .refine((d) => d.trade_id || d.symbol, "حدد الصفقة"),
  delete_trade: z
    .object({ trade_id: z.string().uuid().nullish(), symbol: z.string().max(20).nullish() })
    .refine((d) => d.trade_id || d.symbol, "حدد الصفقة"),
  delete_note: z.object({ title: z.string().min(1).max(200) }),
  start_session: z.object({
    plan: z.string().min(1).max(2000),
    mood: z.string().max(40).nullish(),
  }),
  end_session: z.object({ review: z.string().max(4000).default("") }),
  start_cooldown: z.object({ minutes: z.coerce.number().int().min(1).max(1440).nullish() }),
  mark_notifications_read: z.object({}).passthrough(),
  capital_move: z.object({
    kind: z.enum(["deposit", "withdrawal", "set_balance"]),
    amount: num.min(0),
    note: z.string().max(300).nullish(),
  }),
  attach_trade_image: z.object({ trade_id: z.string().uuid().nullish(), symbol: z.string().max(20).nullish() }).refine((d) => d.trade_id || d.symbol, "حدد الصفقة"),
  remove_trade_image: z.object({ trade_id: z.string().uuid().nullish(), symbol: z.string().max(20).nullish() }).refine((d) => d.trade_id || d.symbol, "حدد الصفقة"),
  add_violation: z.object({ note: z.string().min(1).max(500), rule: z.string().max(200).nullish(), symbol: z.string().max(20).nullish() }),
  delete_violation: z.object({ id: z.string().uuid().nullish() }),
  delete_daily_plan: z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() }),
  update_session: z.object({ id: z.string().uuid().nullish(), plan: opt, review: opt, mood: z.string().max(40).nullish() }),
  delete_session: z.object({ id: z.string().uuid().nullish() }),
  rename_thread: z.object({ title: z.string().min(1).max(200), new_title: z.string().min(1).max(200) }),
  delete_notifications: z.object({}).passthrough(),
  set_guard_style: z.object({ style: z.string().min(1).max(2000) }),
  update_focus: z.object({
    markets: z.union([z.string().max(200), z.array(z.string().max(30)).max(10)]).nullish(),
    goal: opt,
    weakness: opt,
    focus_rule: opt,
    style: opt,
    add_note: opt,
    remove_note: opt,
  }),
} satisfies Record<ActionType, z.ZodType>;

export const isActionType = (t: unknown): t is ActionType => typeof t === "string" && (ACTION_TYPES as readonly string[]).includes(t);

function validate(a: AgentAction) {
  if (!isActionType(a.type)) return null;
  try {
    return SCHEMAS[a.type].safeParse(JSON.parse(a.data));
  } catch {
    return null;
  }
}

export function parseAction(a: AgentAction) {
  const r = validate(a);
  return r?.success ? r.data : null;
}

/** Why an action cannot run, or null when its data is valid. */
export function actionIssue(a: AgentAction): string | null {
  if (!isActionType(a.type)) return "إجراء غير معروف";
  const r = validate(a);
  if (r?.success) return null;
  // Our own refinements speak Arabic; zod's English defaults stay generic.
  return r?.error.issues.find((i) => /[؀-ۿ]/.test(i.message))?.message ?? "بيانات ناقصة";
}
