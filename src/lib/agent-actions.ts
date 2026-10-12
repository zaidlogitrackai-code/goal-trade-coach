import { findDuplicate } from "./trade-dedupe";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { currentUserId } from "@/lib/queries";
import { validateRiskSettings, type RiskSettingsInput } from "@/lib/risk-validation";
import { evaluateTradeGate, type TradeInput } from "@/lib/trade-gate";
import { computeDayMetrics, startOfToday } from "@/lib/trading-status";
import { inMarkets, type FocusPatch } from "@/lib/focus";
import { readFocus, saveFocus } from "@/lib/focus-store";
import { FOREX_ONLY_MSG, forexSymbol, isForex } from "@/lib/forex";
import type { CapitalMove } from "@/lib/capital";
import { HIDDEN_NOTES, isHiddenNote } from "@/lib/hidden-notes";
import { loadCapital, moveCapital } from "@/lib/capital-store";

/**
 * Actions the AI coach can run. In the coach they run automatically, except
 * deletions and anything that loosens a risk limit, which wait for a click.
 * The trade gate still applies and the AI can never end a cooldown early.
 */
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
  "capital_move",
  "save_analysis",
  "delete_analysis",
  "delete_thread",
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
  capital_move: "حركة على رأس المال",
  save_analysis: "حفظ تحليل شارت",
  delete_analysis: "حذف تحليل",
  delete_thread: "حذف محادثة",
};

/** Always wait for an explicit click, even in auto mode. */
export const DESTRUCTIVE: readonly ActionType[] = [
  "delete_trade",
  "delete_strategy",
  "delete_rule",
  "delete_note",
  "delete_analysis",
  "delete_thread",
];

/** Thrown in auto mode when an action needs the user's click first. */
export class NeedsConfirmation extends Error {}
/** The action had nothing to do because the data is already saved. */
export class AlreadySaved extends Error {}

/** Limits where a bigger number (or 0 = disabled) means less protection. */
const LIMIT_KEYS = [
  "max_daily_loss",
  "max_trades_per_day",
  "max_risk_per_trade",
  "max_daily_risk",
  "max_consecutive_losses",
  "weekly_max_loss",
  "monthly_max_loss",
] as const;

/** Which keys in a settings patch weaken protection compared to the current settings. */
export function loosenedLimits(
  current: Record<string, unknown> | null,
  patch: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  const cur = (k: string) => Number(current?.[k] ?? 0) || 0;
  for (const k of LIMIT_KEYS) {
    if (!(k in patch)) continue;
    const next = Number(patch[k]) || 0;
    const now = cur(k);
    if (now > 0 && (next === 0 || next > now)) out.push(k);
  }
  if (
    "cooldown_minutes" in patch &&
    (Number(patch["cooldown_minutes"]) || 0) < cur("cooldown_minutes")
  )
    out.push("cooldown_minutes");
  return out;
}

const num = z.coerce.number().finite();
const opt = z.string().max(2000).nullish();
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
] as const;

export const SCHEMAS = {
  update_settings: z
    .object({
      ...Object.fromEntries(SETTINGS_KEYS.map((k) => [k, num.min(0).optional()])),
      currency: z.string().max(5).optional(),
      display_name: z.string().max(60).optional(),
    })
    .partial(),
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
    status: z.enum(["open", "closed"]).catch("open").optional(),
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
  update_focus: z.object({
    markets: z.union([z.string().max(200), z.array(z.string().max(30)).max(10)]).nullish(),
    goal: opt,
    weakness: opt,
    focus_rule: opt,
    style: opt,
    add_note: opt,
    remove_note: opt,
  }),
};

export function parseAction(a: AgentAction) {
  if (!(ACTION_TYPES as readonly string[]).includes(a.type)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(a.data);
  } catch {
    return null;
  }
  const r = SCHEMAS[a.type].safeParse(raw);
  return r.success ? r.data : null;
}

const sym = (s?: string | null) =>
  forexSymbol(s) ?? ((s ?? "").toUpperCase().replace(/[\s/]/g, "") || "غير محدد");
/** New trades are Forex only; closing or editing an old non-Forex trade still works. */
const requireForex = (s?: string | null) => {
  if (s && !isForex(s)) throw new Error(`${FOREX_ONLY_MSG} (${s})`);
};

type Upd<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** Copy only the keys the AI actually sent (null clears a text field; undefined = untouched). */
function pick<T extends Record<string, unknown>>(d: T, keys: string[]) {
  return Object.fromEntries(keys.filter((k) => d[k] !== undefined).map((k) => [k, d[k]]));
}

async function listNamed(
  table: "strategies" | "trading_rules" | "knowledge_notes",
): Promise<{ id: string; label: string }[]> {
  if (table === "strategies") {
    const { data, error } = await supabase.from("strategies").select("id,name");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ id: r.id, label: r.name }));
  }
  if (table === "trading_rules") {
    const { data, error } = await supabase.from("trading_rules").select("id,title");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ id: r.id, label: r.title }));
  }
  const { data, error } = await supabase.from("knowledge_notes").select("id,title")
    .not("category", "in", HIDDEN_NOTES);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ id: r.id, label: r.title }));
}

async function findByName(
  table: "strategies" | "trading_rules" | "knowledge_notes",
  value: string,
) {
  const row = (await listNamed(table)).find((r) => same(r.label, value));
  if (!row) throw new Error(`ما لقيت "${value}"`);
  return row.id;
}

async function findTrade(ref: { trade_id?: string | null; symbol?: string | null }) {
  if (ref.trade_id) {
    const { data } = await supabase
      .from("trades")
      .select("id,status,stop_loss")
      .eq("id", ref.trade_id)
      .maybeSingle();
    if (data) return data;
  }
  if (!ref.symbol) throw new Error("ما لقيت الصفقة");
  const { data } = await supabase
    .from("trades")
    .select("id,status,stop_loss")
    .eq("symbol", sym(ref.symbol))
    .order("opened_at", { ascending: false })
    .limit(5);
  const row = data?.find((t) => t.status === "open") ?? data?.[0];
  if (!row) throw new Error(`ما لقيت صفقة على ${sym(ref.symbol)}`);
  return row;
}

/** In auto mode, actions that need a click throw NeedsConfirmation instead of running. */
export async function runAction(a: AgentAction, opts: { auto?: boolean } = {}): Promise<void> {
  const d = parseAction(a) as Record<string, unknown> | null;
  if (!d) throw new Error("بيانات الإجراء غير صالحة");
  if (opts.auto && DESTRUCTIVE.includes(a.type)) throw new NeedsConfirmation("الحذف يحتاج موافقتك");
  const user_id = await currentUserId();
  const check = (e: { message: string } | null) => {
    if (e) throw new Error(e.message);
  };
  switch (a.type) {
    case "update_settings": {
      // AI-proposed limits pass the same validation as the settings form.
      const { data: current } = await supabase
        .from("trading_settings")
        .select("*")
        .eq("user_id", user_id)
        .maybeSingle();
      if (opts.auto && loosenedLimits(current as Record<string, unknown> | null, d).length)
        throw new NeedsConfirmation("تخفيف حدود المخاطر يحتاج موافقتك");
      const merged = { currency: "USD", ...(current ?? {}), ...d } as unknown as RiskSettingsInput;
      const v = validateRiskSettings(merged);
      // Only block on problems this change creates; an old conflict in saved settings
      // must not stop the AI from changing an unrelated value.
      const before = validateRiskSettings({ currency: "USD", ...(current ?? {}) } as unknown as RiskSettingsInput);
      const fresh = v.errors.filter((e) => !before.errors.some((b) => b.message === e.message));
      if (fresh.length) throw new Error(fresh.map((i) => i.message).join(" "));
      const { error } = await supabase
        .from("trading_settings")
        .upsert({ user_id, ...d, onboarded: true, updated_at: new Date().toISOString() });
      return check(error);
    }
    case "add_strategy": {
      const { error } = await supabase
        .from("strategies")
        .insert({ user_id, ...(d as { name: string }) });
      return check(error);
    }
    case "add_rule": {
      const { error } = await supabase
        .from("trading_rules")
        .insert({ user_id, ...(d as { title: string }) });
      return check(error);
    }
    case "add_note": {
      const { error } = await supabase
        .from("knowledge_notes")
        .insert({
          user_id,
          ...(d as { title: string; category: string }),
          // The focus profile row is written only through update_focus.
          ...(isHiddenNote((d as { category?: string }).category) ? { category: "عام" } : {}),
        });
      return check(error);
    }
    case "capital_move": {
      await moveCapital(d as CapitalMove);
      return;
    }
    case "update_focus": {
      await saveFocus(d as FocusPatch);
      return;
    }
    case "create_trade": {
      const { strategy, status, pnl, exit_price, risk_amount, opened_at, ...t } = d as {
        opened_at?: string | null;
        strategy?: string | null;
        status?: string;
        pnl?: number | null;
        exit_price?: number | null;
        risk_amount?: number | null;
        symbol?: string | null;
        direction: string;
      };
      let strategy_id: string | null = null;
      if (strategy) {
        const { data } = await supabase.from("strategies").select("id,name");
        strategy_id = data?.find((s) => s.name.trim() === strategy.trim())?.id ?? null;
      }
      requireForex(t.symbol);
      const closed = status === "closed" || (pnl != null && Number.isFinite(pnl));
      const now = new Date().toISOString();
      const openedAt = opened_at && Number.isFinite(new Date(opened_at).getTime()) ? new Date(opened_at).toISOString() : null;
      // Same trade uploaded again (e.g. a second MT5 screenshot): update instead of duplicating.
      {
        const { data: rows } = await supabase
          .from("trades")
          .select("id,symbol,direction,entry_price,status,opened_at")
          .eq("symbol", sym(t.symbol))
          .order("opened_at", { ascending: false })
          .limit(50);
        const dup = findDuplicate(rows ?? [], {
          symbol: sym(t.symbol),
          direction: t.direction,
          entry_price: (t as { entry_price?: number | null }).entry_price ?? null,
          opened_at: openedAt,
        });
        if (dup) {
          if (closed && dup.status === "open") {
            const { error } = await supabase
              .from("trades")
              .update({ status: "closed", pnl: pnl ?? 0, exit_price: exit_price ?? null, closed_at: now })
              .eq("id", dup.id);
            return check(error);
          }
          throw new AlreadySaved("الصفقة مسجّلة من قبل، ما كررتها");
        }
      }
      let gatedRisk: number | null = null;
      if (!closed && opts.auto) {
        // Staying on the trader's own markets is the point of the focus profile.
        const focus = await readFocus();
        if (inMarkets(t.symbol, focus.markets) === false)
          throw new NeedsConfirmation(`${sym(t.symbol)} برّا سوقك (${focus.markets.join("، ")}). بدها موافقتك.`);
      }
      if (!closed) {
        // A new open trade from the AI goes through the trade gate. The AI path
        // cannot override: soft reasons must be justified in the trade form.
        const tt = t as Omit<TradeInput, "symbol" | "risk_amount" | "strategy_id"> & {
          symbol?: string | null;
        };
        const risk =
          risk_amount ??
          (tt.entry_price != null && tt.stop_loss != null && tt.position_size != null
            ? Math.abs(tt.entry_price - tt.stop_loss) * tt.position_size
            : null);
        const gate = await gateForAiTrade({
          ...tt,
          symbol: sym(tt.symbol),
          risk_amount: risk,
          strategy_id,
          checklist_passed: false,
        });
        if (!gate.allowed)
          throw new Error(
            `بوابة التداول رفضت الصفقة: ${gate.reasons.join(" ")} ${gate.nextAction}`,
          );
        gatedRisk = gate.metrics.tradeRisk;
      }
      const { error } = await supabase.from("trades").insert({
        user_id,
        ...t,
        symbol: sym(t.symbol),
        direction: t.direction as "long" | "short",
        risk_amount: gatedRisk ?? risk_amount ?? 0,
        strategy_id,
        checklist_passed: false,
        ...(openedAt ? { opened_at: openedAt } : {}),
        ...(closed
          ? {
              status: "closed" as const,
              pnl: pnl ?? 0,
              exit_price: exit_price ?? null,
              closed_at: now,
            }
          : {}),
      });
      return check(error);
    }
    case "close_trade": {
      const c = d as {
        symbol?: string | null;
        pnl: number;
        exit_price?: number | null;
        notes?: string | null;
      };
      let q = supabase.from("trades").select("id").eq("status", "open");
      if (c.symbol) q = q.eq("symbol", sym(c.symbol));
      const { data } = await q.order("opened_at", { ascending: false }).limit(1);
      const id = data?.[0]?.id;
      const now = new Date().toISOString();
      if (!id) {
        requireForex(c.symbol);
        // No matching open trade: record it directly as a finished trade so it still shows in the log.
        const { error } = await supabase
          .from("trades")
          .insert({
            user_id,
            symbol: sym(c.symbol),
            direction: "long",
            risk_amount: 0,
            checklist_passed: false,
            status: "closed",
            pnl: c.pnl,
            exit_price: c.exit_price ?? null,
            close_notes: c.notes ?? null,
            closed_at: now,
          });
        return check(error);
      }
      const { error } = await supabase
        .from("trades")
        .update({
          status: "closed",
          pnl: c.pnl,
          exit_price: c.exit_price ?? null,
          close_notes: c.notes ?? null,
          closed_at: now,
        })
        .eq("id", id);
      return check(error);
    }
    case "update_trade": {
      const trade = await findTrade(d as { trade_id?: string | null; symbol?: string | null });
      const patch: Record<string, unknown> = pick(d, [
        "entry_price",
        "stop_loss",
        "take_profit",
        "position_size",
        "emotion",
        "notes",
        "close_notes",
      ]);
      if (trade.status === "closed") Object.assign(patch, pick(d, ["pnl", "exit_price"]));
      if (
        opts.auto &&
        trade.status === "open" &&
        "stop_loss" in patch &&
        patch["stop_loss"] !== trade.stop_loss
      )
        throw new NeedsConfirmation("تحريك وقف الخسارة يحتاج موافقتك");
      if (typeof d["strategy"] === "string")
        patch["strategy_id"] = await findByName("strategies", d["strategy"]);
      if (Object.keys(patch).length === 0) throw new Error("ما فيه تعديل");
      const { error } = await supabase
        .from("trades")
        .update(patch as Upd<"trades">)
        .eq("id", trade.id);
      return check(error);
    }
    case "delete_trade": {
      const trade = await findTrade(d as { trade_id?: string | null; symbol?: string | null });
      const { error } = await supabase.from("trades").delete().eq("id", trade.id);
      return check(error);
    }
    case "update_strategy": {
      const id = await findByName("strategies", String(d["name"]));
      const patch: Record<string, unknown> = pick(d, [
        "description",
        "entry_conditions",
        "exit_conditions",
        "markets",
        "timeframes",
      ]);
      if (d["new_name"]) patch["name"] = d["new_name"];
      if (typeof d["allowed"] === "boolean") patch["allowed"] = d["allowed"];
      const { error } = await supabase
        .from("strategies")
        .update(patch as Upd<"strategies">)
        .eq("id", id);
      return check(error);
    }
    case "delete_strategy": {
      const id = await findByName("strategies", String(d["name"]));
      const { error } = await supabase.from("strategies").delete().eq("id", id);
      return check(error);
    }
    case "update_rule": {
      const id = await findByName("trading_rules", String(d["title"]));
      const patch: Record<string, unknown> = pick(d, ["description"]);
      if (d["new_title"]) patch["title"] = d["new_title"];
      if (typeof d["active"] === "boolean") patch["active"] = d["active"];
      const { error } = await supabase
        .from("trading_rules")
        .update(patch as Upd<"trading_rules">)
        .eq("id", id);
      return check(error);
    }
    case "delete_rule": {
      const id = await findByName("trading_rules", String(d["title"]));
      const { error } = await supabase.from("trading_rules").delete().eq("id", id);
      return check(error);
    }
    case "delete_note": {
      const id = await findByName("knowledge_notes", String(d["title"]));
      const { error } = await supabase.from("knowledge_notes").delete().eq("id", id);
      return check(error);
    }
    case "start_session": {
      const { data: open } = await supabase
        .from("trading_sessions")
        .select("id")
        .is("ended_at", null)
        .limit(1);
      if (open?.length) throw new Error("فيه جلسة مفتوحة. أنهها أولًا.");
      const s = d as { plan: string; mood?: string | null };
      const { error } = await supabase
        .from("trading_sessions")
        .insert({ user_id, plan: s.plan, mood: s.mood ?? null });
      return check(error);
    }
    case "end_session": {
      const { data: open } = await supabase
        .from("trading_sessions")
        .select("id")
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1);
      const id = open?.[0]?.id;
      if (!id) throw new Error("ما فيه جلسة مفتوحة");
      const { error } = await supabase
        .from("trading_sessions")
        .update({ ended_at: new Date().toISOString(), review: String(d["review"] ?? "") })
        .eq("id", id);
      return check(error);
    }
    case "start_cooldown": {
      // The AI can start or extend a cooldown, never shorten or end one.
      const { data: cur } = await supabase
        .from("trading_settings")
        .select("cooldown_minutes,cooldown_until")
        .eq("user_id", user_id)
        .maybeSingle();
      const minutes = Number(d["minutes"]) || cur?.cooldown_minutes || 30;
      const until = Date.now() + minutes * 60_000;
      const existing = cur?.cooldown_until ? new Date(cur.cooldown_until).getTime() : 0;
      const { error } = await supabase
        .from("trading_settings")
        .update({ cooldown_until: new Date(Math.max(until, existing)).toISOString() })
        .eq("user_id", user_id);
      return check(error);
    }
    case "save_analysis": {
      const a2 = d as { symbol?: string | null; timeframe?: string | null; question?: string | null; result: string };
      const { error } = await supabase.from("chart_analyses").insert({ user_id, ...a2 });
      return check(error);
    }
    case "delete_analysis": {
      let q = supabase.from("chart_analyses").select("id").order("created_at", { ascending: false }).limit(1);
      if (d["id"]) q = q.eq("id", String(d["id"]));
      else if (d["symbol"]) q = q.ilike("symbol", String(d["symbol"]));
      const { data: rows } = await q;
      const id = rows?.[0]?.id;
      if (!id) throw new Error("ما لقيت التحليل");
      const { error } = await supabase.from("chart_analyses").delete().eq("id", id);
      return check(error);
    }
    case "delete_thread": {
      const { data: rows } = await supabase.from("coach_threads").select("id,title");
      const id = rows?.find((r) => r.title.trim() === String(d["title"]).trim())?.id;
      if (!id) throw new Error("ما لقيت المحادثة");
      await supabase.from("coach_messages").delete().eq("thread_id", id);
      const { error } = await supabase.from("coach_threads").delete().eq("id", id);
      return check(error);
    }
    case "mark_notifications_read": {
      const { error } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("read", false);
      return check(error);
    }
  }
}

async function gateForAiTrade(input: TradeInput) {
  const since = startOfToday().toISOString();
  const [settings, trades, violations, session, strategies] = await Promise.all([
    supabase.from("trading_settings").select("*").maybeSingle(),
    supabase.from("trades").select("status,pnl,risk_amount,opened_at,closed_at"),
    supabase.from("rule_violations").select("id").gte("occurred_at", since),
    supabase
      .from("trading_sessions")
      .select("id,started_at,plan,mood")
      .is("ended_at", null)
      .limit(1),
    supabase.from("strategies").select("id").eq("allowed", true),
  ]);
  const err =
    settings.error ?? trades.error ?? violations.error ?? session.error ?? strategies.error;
  if (err) throw new Error(err.message);
  if (!settings.data) throw new Error("أكمل إعداد حدود المخاطر قبل تسجيل الصفقات.");
  const all = trades.data ?? [];
  // Same gate as the new-trade form. The AI path never overrides a blocked trade.
  return evaluateTradeGate({
    settings: settings.data,
    metrics: computeDayMetrics(settings.data, all, violations.data?.length ?? 0),
    input,
    activeSession: session.data?.[0] ?? null,
    allowedStrategyIds: (strategies.data ?? []).map((x) => x.id),
    openTrades: all.filter((x) => x.status === "open"),
    currentBalance: (await loadCapital()).summary.balance,
  });
}
