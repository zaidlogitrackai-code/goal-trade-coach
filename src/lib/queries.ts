import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Settings = Database["public"]["Tables"]["trading_settings"]["Row"];
export type Trade = Database["public"]["Tables"]["trades"]["Row"];
export type Strategy = Database["public"]["Tables"]["strategies"]["Row"];
export type Rule = Database["public"]["Tables"]["trading_rules"]["Row"];
export type Violation = Database["public"]["Tables"]["rule_violations"]["Row"];

async function uid() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("غير مسجل الدخول");
  return data.user.id;
}

export const settingsQuery = queryOptions({
  queryKey: ["settings"],
  queryFn: async () => {
    const id = await uid();
    const { data, error } = await supabase.from("trading_settings").select("*").eq("user_id", id).maybeSingle();
    if (error) throw error;
    return data;
  },
});

export const tradesQuery = queryOptions({
  queryKey: ["trades"],
  queryFn: async () => {
    const { data, error } = await supabase.from("trades").select("*").order("opened_at", { ascending: false });
    if (error) throw error;
    return data;
  },
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
