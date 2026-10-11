import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { focusQuery } from "@/lib/focus-store";
import { buildJourney, type Journey } from "@/lib/journey";
import {
  rulesQuery,
  settingsQuery,
  strategiesQuery,
  tradesQuery,
  violationsQuery,
} from "@/lib/queries";
import {
  computeDayMetrics,
  computeStatus,
  startOfToday,
  type TradingStatus,
} from "@/lib/trading-status";

/** Sessions started today, newest first. Invalidated with ["sessions"]. */
export const todaySessionsQuery = {
  queryKey: ["sessions", "today"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("trading_sessions")
      .select("id,started_at,ended_at")
      .gte("started_at", startOfToday().toISOString())
      .order("started_at", { ascending: false });
    if (error) throw error;
    return data;
  },
} as const;

export const isBlocked = (s: TradingStatus) =>
  s === "stopped" || s === "loss_limit" || s === "target_hit";

/** The client's steps from cached queries; null while anything is still loading. */
export function useJourney(): { journey: Journey; status: TradingStatus } | null {
  const s = useQuery(settingsQuery);
  const t = useQuery(tradesQuery);
  const st = useQuery(strategiesQuery);
  const r = useQuery(rulesQuery);
  const v = useQuery(violationsQuery);
  const f = useQuery(focusQuery);
  const today = useQuery(todaySessionsQuery);
  if (!s.data || !t.data || !st.data || !r.data || !v.data || !f.data || !today.data) return null;

  const start = startOfToday().getTime();
  const violationsToday = v.data.filter((x) => new Date(x.occurred_at).getTime() >= start).length;
  const status = computeStatus(s.data, computeDayMetrics(s.data, t.data, violationsToday));
  const latest = today.data[0];
  const journey = buildJourney({
    focusReady: f.data.markets.length > 0 && !!(f.data.goal || f.data.weakness),
    strategies: st.data.length,
    rules: r.data.length,
    sessionToday: latest ? { active: !latest.ended_at, ended: !!latest.ended_at } : null,
    tradesToday: t.data.filter((x) => new Date(x.opened_at).getTime() >= start).length,
    blocked: isBlocked(status),
  });
  return { journey, status };
}
