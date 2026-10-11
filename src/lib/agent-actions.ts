import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { currentUserId } from "@/lib/queries";

/** Actions the AI coach proposes; each one runs only after the user approves it. */
export type AgentAction = { type: ActionType; summary: string; data: string };
export const ACTION_TYPES = ["update_settings", "add_strategy", "add_rule", "create_trade", "close_trade", "add_note"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const ACTION_LABEL: Record<ActionType, string> = {
  update_settings: "تعديل الحدود والأهداف",
  add_strategy: "إضافة استراتيجية",
  add_rule: "إضافة قاعدة",
  create_trade: "تسجيل صفقة",
  close_trade: "إغلاق صفقة",
  add_note: "إضافة ملاحظة للمعرفة",
};

const num = z.coerce.number().finite();
const opt = z.string().max(2000).nullish();
const SETTINGS_KEYS = ["starting_balance", "daily_target", "max_daily_profit", "max_daily_loss", "max_trades_per_day", "max_risk_per_trade", "max_daily_risk", "max_consecutive_losses", "weekly_target", "weekly_max_loss", "monthly_target", "monthly_max_loss", "cooldown_minutes"] as const;

export const SCHEMAS = {
  update_settings: z.object({
    ...Object.fromEntries(SETTINGS_KEYS.map((k) => [k, num.min(0).optional()])),
    currency: z.string().max(5).optional(),
    display_name: z.string().max(60).optional(),
  }).partial(),
  add_strategy: z.object({ name: z.string().min(1).max(80), description: opt, entry_conditions: opt, exit_conditions: opt, markets: opt, timeframes: opt }),
  add_rule: z.object({ title: z.string().min(1).max(200), description: opt }),
  create_trade: z.object({
    symbol: z.string().min(1).max(20), direction: z.enum(["long", "short"]),
    entry_price: num.nullish(), stop_loss: num.nullish(), take_profit: num.nullish(), position_size: num.nullish(),
    risk_amount: num.min(0).default(0), strategy: z.string().nullish(), emotion: z.string().max(20).nullish(), notes: opt,
  }),
  close_trade: z.object({ symbol: z.string().min(1).max(20), pnl: num, exit_price: num.nullish(), notes: opt }),
  add_note: z.object({ title: z.string().min(1).max(200), content: z.string().max(5000).default(""), category: z.string().max(40).default("عام") }),
};

export function parseAction(a: AgentAction) {
  if (!(ACTION_TYPES as readonly string[]).includes(a.type)) return null;
  let raw: unknown;
  try { raw = JSON.parse(a.data); } catch { return null; }
  const r = SCHEMAS[a.type].safeParse(raw);
  return r.success ? r.data : null;
}

const sym = (s: string) => s.toUpperCase().replace(/[\s/]/g, "");

export async function runAction(a: AgentAction): Promise<void> {
  const d = parseAction(a) as Record<string, unknown> | null;
  if (!d) throw new Error("بيانات الإجراء غير صالحة");
  const user_id = await currentUserId();
  const check = (e: { message: string } | null) => { if (e) throw new Error(e.message); };
  switch (a.type) {
    case "update_settings": {
      const { error } = await supabase.from("trading_settings").upsert({ user_id, ...d, onboarded: true, updated_at: new Date().toISOString() });
      return check(error);
    }
    case "add_strategy": {
      const { error } = await supabase.from("strategies").insert({ user_id, ...(d as { name: string }) });
      return check(error);
    }
    case "add_rule": {
      const { error } = await supabase.from("trading_rules").insert({ user_id, ...(d as { title: string }) });
      return check(error);
    }
    case "add_note": {
      const { error } = await supabase.from("knowledge_notes").insert({ user_id, ...(d as { title: string }) });
      return check(error);
    }
    case "create_trade": {
      const { strategy, ...t } = d as { strategy?: string | null; symbol: string; direction: string };
      let strategy_id: string | null = null;
      if (strategy) {
        const { data } = await supabase.from("strategies").select("id,name");
        strategy_id = data?.find((s) => s.name.trim() === strategy.trim())?.id ?? null;
      }
      const { error } = await supabase.from("trades").insert({ user_id, ...t, symbol: sym(t.symbol), strategy_id, checklist_passed: false });
      return check(error);
    }
    case "close_trade": {
      const c = d as { symbol: string; pnl: number; exit_price?: number | null; notes?: string | null };
      const { data } = await supabase.from("trades").select("id").eq("status", "open").eq("symbol", sym(c.symbol)).order("opened_at", { ascending: false }).limit(1);
      const id = data?.[0]?.id;
      if (!id) throw new Error("ما لقيت صفقة مفتوحة على هذا الأصل");
      const { error } = await supabase.from("trades").update({ status: "closed", pnl: c.pnl, exit_price: c.exit_price ?? null, close_notes: c.notes ?? null, closed_at: new Date().toISOString() }).eq("id", id);
      return check(error);
    }
  }
}
