import { nextDaily } from "./risk-watch";
import { checkLevels, riskUsd } from "./trade-idea";
import { findDuplicate } from "./trade-dedupe";
import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { currentUserId } from "@/lib/queries";
import { validateRiskSettings, type RiskSettingsInput } from "@/lib/risk-validation";
import type { TradeInput } from "@/lib/trade-gate";
import { dayKey, dayStart } from "@/lib/trading-day";
import { isPlanRevision } from "@/lib/daily-plan";
import type { FocusPatch } from "@/lib/focus";
import { readFocus, saveFocus } from "@/lib/focus-store";
import { FOREX_ONLY_MSG, forexSymbol, isForex } from "@/lib/forex";
import type { CapitalMove } from "@/lib/capital";
import { GUARD_STYLE_CATEGORY, HIDDEN_NOTES, isHiddenNote } from "@/lib/hidden-notes";
import { loadCapital, moveCapital, syncLimitsPct } from "@/lib/capital-store";
import { anchorBalance, applyPctLimits } from "@/lib/effective-limits";
import { makeThumbnail } from "@/lib/image";
import { actionIssue, isClosedUpload, parseAction, type ActionType, type AgentAction } from "@/lib/agent-action-spec";
import { needsApproval, type PolicyContext } from "@/lib/action-policy";
import { parseTradeCard, splitTradeBlock } from "@/lib/trade-card";

/**
 * Runs the AI's actions in the browser. What an action is and whether it may run by
 * itself live in agent-action-spec.ts and action-policy.ts; this file only loads the
 * facts the policy needs and writes the rows. A trade with contradicting levels is
 * refused and the AI can never end a cooldown early.
 */

/** The last image the user sent in chat, so the agent can attach it to a trade. */
let lastImage: string | null = null;
export function rememberChatImage(img: string | null) {
  if (img) lastImage = img;
}

/** Thrown in auto mode when an action needs the user's click first. */
export class NeedsConfirmation extends Error {}
/** The action had nothing to do because the data is already saved. */
export class AlreadySaved extends Error {}

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

const TRADE_COLUMNS = "id,status,stop_loss,direction,pnl,exit_price";
type TradeRef = { trade_id?: string | null; symbol?: string | null };

async function findTrade(ref: TradeRef) {
  if (ref.trade_id) {
    const { data } = await supabase
      .from("trades")
      .select(TRADE_COLUMNS)
      .eq("id", ref.trade_id)
      .maybeSingle();
    if (data) return data;
  }
  if (!ref.symbol) throw new Error("ما لقيت الصفقة");
  const { data } = await supabase
    .from("trades")
    .select(TRADE_COLUMNS)
    .eq("symbol", sym(ref.symbol))
    .order("opened_at", { ascending: false })
    .limit(5);
  const row = data?.find((t) => t.status === "open") ?? data?.[0];
  if (!row) throw new Error(`ما لقيت صفقة على ${sym(ref.symbol)}`);
  return row;
}

/** A read the policy can't judge without: a failed one waits for his click instead of guessing «not looser». */
const UNSURE = "ما قدرت أتأكد إن هذا ما يخفف حمايتك، فيحتاج موافقتك";
function sure<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new NeedsConfirmation(UNSURE);
  return r.data;
}

/**
 * Today's dollar limits as the breaker and the gate read them: limits_pct on the day's
 * anchor balance. The dollars on file go stale after losses, so a raise below them can
 * still loosen the limit in force.
 */
async function limitsInForce(user_id: string) {
  const s = sure(await supabase.from("trading_settings").select("*").eq("user_id", user_id).maybeSingle());
  if (!s) return null;
  const [plan, capital] = await Promise.all([
    supabase.from("daily_plans").select("start_balance").eq("day", dayKey(new Date(), s.timezone)).maybeSingle().then(sure),
    loadCapital().catch(() => {
      throw new NeedsConfirmation(UNSURE);
    }),
  ]);
  return applyPctLimits(s, anchorBalance(plan, capital.summary.balance));
}

/** The facts needsApproval compares an action with; only the few actions that can loosen something read anything. */
async function policyContext(type: ActionType, d: Record<string, unknown>, user_id: string): Promise<PolicyContext> {
  switch (type) {
    case "update_settings":
      return { limits: await limitsInForce(user_id) };
    case "set_daily_plan": {
      const st = sure(await supabase.from("trading_settings").select("timezone").eq("user_id", user_id).maybeSingle());
      const now = new Date();
      const [plan, today] = await Promise.all([
        supabase.from("daily_plans").select("target,max_trades,risk_per_trade,max_loss").eq("day", dayKey(now, st?.timezone)).maybeSingle().then(sure),
        supabase.from("trades").select("id").gte("opened_at", dayStart(now, st?.timezone).toISOString()).limit(1).then(sure),
      ]);
      return { plan, tradesToday: today?.length ?? 0 };
    }
    case "update_trade":
      return { target: await findTrade(d as TradeRef) };
    case "update_rule": {
      const rows = sure(await supabase.from("trading_rules").select("title,active"));
      return { target: rows?.find((r) => same(r.title, String(d["title"]))) ?? null };
    }
    case "update_strategy": {
      const rows = sure(await supabase.from("strategies").select("name,allowed"));
      return { target: rows?.find((r) => same(r.name, String(d["name"]))) ?? null };
    }
    case "create_trade":
      // Staying on the trader's own markets is the point of the focus profile.
      return isClosedUpload(d) ? {} : { focusMarkets: (await readFocus()).markets };
    default:
      return {};
  }
}

/**
 * In auto mode an action the policy holds back throws NeedsConfirmation instead of running;
 * with auto off his click is the approval. `note` is what the policy wants said after a run.
 */
export async function runAction(a: AgentAction, opts: { auto?: boolean } = {}): Promise<{ note: string | null }> {
  const d = parseAction(a) as Record<string, unknown> | null;
  if (!d) throw new Error(actionIssue(a) ?? "بيانات الإجراء غير صالحة");
  const user_id = await currentUserId();
  let note: string | null = null;
  if (opts.auto) {
    const v = needsApproval({ type: a.type, data: d }, await policyContext(a.type, d, user_id));
    if (v.click) throw new NeedsConfirmation(v.reason ?? "يحتاج موافقتك");
    note = v.note;
  }
  await execute(a.type, d, user_id);
  return { note };
}

async function execute(type: ActionType, d: Record<string, unknown>, user_id: string): Promise<void> {
  const check = (e: { message: string } | null) => {
    if (e) throw new Error(e.message);
  };
  switch (type) {
    case "update_settings": {
      // AI-proposed limits pass the same validation as the settings form.
      const { data: current } = await supabase
        .from("trading_settings")
        .select("*")
        .eq("user_id", user_id)
        .maybeSingle();
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
      check(error);
      await syncLimitsPct(d);
      return;
    }
    case "set_daily_plan": {
      const { data: st } = await supabase.from("trading_settings").select("timezone").eq("user_id", user_id).maybeSingle();
      const day = dayKey(new Date(), st?.timezone);
      const p = d as { target?: number | null; max_trades?: number | null; risk_per_trade?: number | null; max_loss?: number | null; note?: string | null };
      const { data: cur } = await supabase.from("daily_plans").select("*").eq("day", day).maybeSingle();
      const clean = Object.fromEntries(Object.entries(p).filter(([, v]) => v != null));
      const { data: traded } = cur
        ? await supabase.from("trades").select("id").gte("opened_at", dayStart(new Date(), st?.timezone).toISOString()).limit(1)
        : { data: null };
      const bump = isPlanRevision(cur, clean, traded?.length ?? 0) ? 1 : 0;
      const { error } = cur
        ? await supabase.from("daily_plans").update({ ...clean, revised_count: cur.revised_count + bump }).eq("id", cur.id)
        : await supabase.from("daily_plans").insert({ user_id, day, ...clean });
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
    case "set_guard_style": {
      const content = String(d["style"]);
      const { data: row } = await supabase.from("knowledge_notes").select("id").eq("category", GUARD_STYLE_CATEGORY).limit(1).maybeSingle();
      const { error } = row
        ? await supabase.from("knowledge_notes").update({ content }).eq("id", row.id)
        : await supabase.from("knowledge_notes").insert({ user_id, title: "طريقة حارس الانضباط", category: GUARD_STYLE_CATEGORY, content });
      return check(error);
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
      // Floating P&L on an open trade is ignored (it never reaches the insert below).
      const closed = isClosedUpload({ status, exit_price, pnl });
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
      if (!closed) {
        // A new open trade from the AI: contradicting levels are refused and the risk is
        // computed, never taken as 0. T23 journals it through pre-trade-gate (already_placed).
        const tt = t as Omit<TradeInput, "symbol" | "risk_amount" | "strategy_id"> & {
          symbol?: string | null;
        };
        if (tt.entry_price != null && tt.stop_loss != null) {
          const lv = checkLevels({
            direction: t.direction as "long" | "short",
            entry: tt.entry_price,
            stop: tt.stop_loss,
            targets: tt.take_profit != null ? [tt.take_profit] : [],
          });
          if (!lv.ok) throw new Error(`أرقام الصفقة متناقضة: ${lv.problems.join("، ")}.`);
        }
        const risk =
          risk_amount ??
          (tt.entry_price != null && tt.stop_loss != null && tt.position_size != null
            ? riskUsd(sym(tt.symbol), tt.entry_price, tt.stop_loss, tt.position_size)
            : null);
        gatedRisk = risk != null && Number.isFinite(risk) ? Math.max(0, risk) : null;
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
    case "add_strategy_example": {
      const strategy_id = d["strategy"] ? await findByName("strategies", String(d["strategy"])).catch(() => null) : null;
      const image = d["with_image"] !== false && lastImage ? await makeThumbnail(lastImage) : null;
      const { error } = await supabase.from("strategy_examples").insert({
        user_id, strategy_id, verdict: String(d["verdict"]), reason: String(d["reason"]),
        symbol: (d["symbol"] as string) ?? null, timeframe: (d["timeframe"] as string) ?? null, image,
      });
      return check(error);
    }
    case "delete_strategy_example": {
      const { error } = await supabase.from("strategy_examples").delete().eq("id", String(d["id"]));
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
      const a2 = d as { symbol?: string | null; timeframe?: string | null; question?: string | null; result: string; card?: unknown };
      // The card is stored as parsed, so the week's analyst stats read one shape.
      const raw = a2.card != null ? (typeof a2.card === "string" ? a2.card : JSON.stringify(a2.card)) : splitTradeBlock(a2.result).raw;
      const parsed = raw ? parseTradeCard(raw) : null;
      const card = parsed?.ok ? parsed.card : null;
      const symbol = a2.symbol ?? card?.symbol ?? null;
      const { error } = await supabase.from("chart_analyses").insert({
        user_id, symbol, timeframe: a2.timeframe ?? card?.timeframe ?? null, question: a2.question ?? null, result: a2.result,
        card: card ? (JSON.parse(JSON.stringify(card)) as Database["public"]["Tables"]["chart_analyses"]["Row"]["card"]) : null,
      });
      if (error) return check(error);
      // «راقبها» is a gate decision too: it lands in the week's "watched, not taken".
      if (card?.intent === "watch") {
        const { error: e2 } = await supabase.from("pre_trade_checks").insert({
          user_id, intent: "watch", decision: "NO_ACTIONABLE", source: "ai", symbol, direction: card.direction === "none" ? null : card.direction,
        });
        if (e2) console.warn("[save_analysis] watch check not saved", e2.message);
      }
      return check(null);
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
    case "add_reminder": {
      const at = (d["at"] as string | null) ?? null;
      const mins = d["in_minutes"] as number | null;
      const repeat = d["repeat"] === "daily" && at ? "daily" : "once";
      let next = new Date(Date.now() + (mins || 1) * 60_000);
      if (!mins && at) {
        // "09:00" means nine on the trader's clock, whatever zone this device is in.
        const { data: st } = await supabase.from("trading_settings").select("timezone").eq("user_id", user_id).maybeSingle();
        next = nextDaily(at, new Date(), st?.timezone);
      }
      const { error } = await supabase.from("reminders").insert({
        user_id, title: String(d["title"]), body: (d["body"] as string | null) ?? "", repeat,
        at_time: at, next_at: next.toISOString(),
      });
      return check(error);
    }
    case "delete_reminder": {
      const { data: rows } = await supabase.from("reminders").select("id,title");
      const id = rows?.find((r) => r.title.trim() === String(d["title"]).trim())?.id;
      if (!id) throw new Error("ما لقيت التذكير");
      const { error } = await supabase.from("reminders").delete().eq("id", id);
      return check(error);
    }
    case "attach_trade_image": {
      if (!lastImage) throw new Error("ارفع الصورة في المحادثة أول");
      const trade = await findTrade(d as { trade_id?: string | null; symbol?: string | null });
      const blob = await (await fetch(lastImage)).blob();
      const ext = blob.type.split("/")[1] ?? "jpg";
      const path = `${user_id}/${trade.id}-${Date.now()}.${ext}`;
      const up = await supabase.storage.from("trade-screenshots").upload(path, blob, { contentType: blob.type, upsert: true });
      check(up.error);
      const { data: old } = await supabase.from("trades").select("screenshot_path").eq("id", trade.id).maybeSingle();
      if (old?.screenshot_path) await supabase.storage.from("trade-screenshots").remove([old.screenshot_path]);
      const { error } = await supabase.from("trades").update({ screenshot_path: path }).eq("id", trade.id);
      return check(error);
    }
    case "remove_trade_image": {
      const trade = await findTrade(d as { trade_id?: string | null; symbol?: string | null });
      const { data: row } = await supabase.from("trades").select("screenshot_path").eq("id", trade.id).maybeSingle();
      if (!row?.screenshot_path) throw new Error("الصفقة ما فيها صورة");
      await supabase.storage.from("trade-screenshots").remove([row.screenshot_path]);
      const { error } = await supabase.from("trades").update({ screenshot_path: null }).eq("id", trade.id);
      return check(error);
    }
    case "add_violation": {
      const rule_id = d["rule"] ? await findByName("trading_rules", String(d["rule"])).catch(() => null) : null;
      const trade_id = d["symbol"] ? (await findTrade({ symbol: String(d["symbol"]) }).catch(() => null))?.id ?? null : null;
      const { error } = await supabase.from("rule_violations").insert({ user_id, note: String(d["note"]), rule_id, trade_id });
      return check(error);
    }
    case "delete_violation": {
      let q = supabase.from("rule_violations").select("id").order("occurred_at", { ascending: false }).limit(1);
      if (d["id"]) q = q.eq("id", String(d["id"]));
      const id = (await q).data?.[0]?.id;
      if (!id) throw new Error("ما لقيت المخالفة");
      const { error } = await supabase.from("rule_violations").delete().eq("id", id);
      return check(error);
    }
    case "delete_daily_plan": {
      let q = supabase.from("daily_plans").select("id").order("day", { ascending: false }).limit(1);
      if (d["day"]) q = q.eq("day", String(d["day"]));
      const id = (await q).data?.[0]?.id;
      if (!id) throw new Error("ما لقيت خطة");
      const { error } = await supabase.from("daily_plans").delete().eq("id", id);
      return check(error);
    }
    case "update_session":
    case "delete_session": {
      let q = supabase.from("trading_sessions").select("id").order("started_at", { ascending: false }).limit(1);
      if (d["id"]) q = q.eq("id", String(d["id"]));
      const id = (await q).data?.[0]?.id;
      if (!id) throw new Error("ما لقيت الجلسة");
      if (type === "delete_session") {
        const { error } = await supabase.from("trading_sessions").delete().eq("id", id);
        return check(error);
      }
      const { error } = await supabase.from("trading_sessions").update(pick(d, ["plan", "review", "mood"]) as Upd<"trading_sessions">).eq("id", id);
      return check(error);
    }
    case "rename_thread": {
      const { data: rows } = await supabase.from("coach_threads").select("id,title");
      const id = rows?.find((r) => r.title.trim() === String(d["title"]).trim())?.id;
      if (!id) throw new Error("ما لقيت المحادثة");
      const { error } = await supabase.from("coach_threads").update({ title: String(d["new_title"]) }).eq("id", id);
      return check(error);
    }
    case "delete_notifications": {
      // Hide, never delete: the rows' dedupe_keys are the once-only locks for alerts and daily messages.
      const { error } = await supabase
        .from("notifications")
        .update({ dismissed: true, read: true })
        .eq("user_id", user_id)
        .eq("dismissed", false);
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
