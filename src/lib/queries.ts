import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CAPITAL_CATEGORY, computeCapital, parseLedger } from "@/lib/capital";
import { applyPctLimits } from "@/lib/effective-limits";
import { fetchAll } from "@/lib/fetch-all";
import { dayKey, safeTz } from "@/lib/trading-day";
import type { Database } from "@/integrations/supabase/types";

export type Settings = Database["public"]["Tables"]["trading_settings"]["Row"];
export type Trade = Database["public"]["Tables"]["trades"]["Row"];
export type Strategy = Database["public"]["Tables"]["strategies"]["Row"];
export type Rule = Database["public"]["Tables"]["trading_rules"]["Row"];
export type Violation = Database["public"]["Tables"]["rule_violations"]["Row"];

/** The signed-in user's id from the stored session: getUser() was a network round trip on every call. */
async function uid() {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error("غير مسجل الدخول");
  return id;
}

export const settingsQuery = queryOptions({
  queryKey: ["settings"],
  queryFn: async () => {
    const id = await uid();
    const { data, error } = await supabase.from("trading_settings").select("*").eq("user_id", id).maybeSingle();
    if (error) throw error;
    if (!data) return data;
    // Limits follow the real current balance (deposits, corrections, closed P&L).
    // A failed read must throw: a balance missing its losses would loosen every % limit.
    const [closed, cap] = await Promise.all([fetchClosedTrades(), readCapitalRow()]);
    const bal = computeCapital({ starting: Number(data.starting_balance) || 0, since: data.created_at, trades: closed, entries: parseLedger(cap?.content).entries }).balance;
    return applyPctLimits(data, bal);
  },
});

/** Every closed trade's P&L for the balance, paged past PostgREST's 1000-row cap. */
export function fetchClosedTrades() {
  return fetchAll((from, to) =>
    supabase.from("trades").select("status,pnl,opened_at,closed_at").eq("status", "closed").order("id").range(from, to),
  );
}

let warnedDuplicateLedger = false;
/** The hidden capital ledger: always the oldest row, the same one capital-store writes to. */
export async function readCapitalRow() {
  const { data, error } = await supabase
    .from("knowledge_notes")
    .select("id,content")
    .eq("category", CAPITAL_CATEGORY)
    .order("created_at", { ascending: true })
    .order("id")
    .limit(2);
  if (error) throw new Error(error.message);
  if ((data?.length ?? 0) > 1 && !warnedDuplicateLedger) {
    warnedDuplicateLedger = true;
    console.warn("[capital] more than one __capital row, using the oldest", data?.map((r) => r.id));
  }
  return data?.[0] ?? null;
}

export const tradesQuery = queryOptions({
  queryKey: ["trades"],
  queryFn: () =>
    fetchAll((from, to) =>
      supabase.from("trades").select("*").order("opened_at", { ascending: false }).order("id").range(from, to),
    ),
  // Re-read every visible minute and on resume by the heartbeat (src/hooks/use-resume.ts).
});

export const strategiesQuery = queryOptions({
  queryKey: ["strategies"],
  queryFn: async () => {
    const { data, error } = await supabase.from("strategies").select("*").order("created_at");
    if (error) throw error;
    return data;
  },
});

export const rulesQuery = queryOptions({
  queryKey: ["rules"],
  queryFn: async () => {
    const { data, error } = await supabase.from("trading_rules").select("*").order("created_at");
    if (error) throw error;
    return data;
  },
});

export const violationsQuery = queryOptions({
  queryKey: ["violations"],
  queryFn: async () => {
    const { data, error } = await supabase.from("rule_violations").select("*").order("occurred_at", { ascending: false });
    if (error) throw error;
    return data;
  },
});

/** The open trading session, if any (ended_at is null). Invalidated with ["sessions"]. */
export const activeSessionQuery = queryOptions({
  queryKey: ["sessions", "active"],
  queryFn: async () => {
    const { data, error } = await supabase.from("trading_sessions").select("*").is("ended_at", null).order("started_at", { ascending: false }).limit(1);
    if (error) throw error;
    return data?.[0] ?? null;
  },
});

export { uid as currentUserId };

export function fmtMoney(n: number | null | undefined, currency = "USD") {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
}

export function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn", { dateStyle: "medium", timeStyle: "short" }).format(new Date(s));
}

/** Today's plan by the trader's calendar day; the heartbeat's resume re-reads it at his midnight. */
export const todayPlanQuery = (tz: string | null | undefined) => ({
  queryKey: ["daily_plan", "today", safeTz(tz)] as const,
  queryFn: async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data, error } = await supabase.from("daily_plans").select("target").eq("day", dayKey(new Date(), tz)).maybeSingle();
    if (error) throw error;
    return data;
  },
});
