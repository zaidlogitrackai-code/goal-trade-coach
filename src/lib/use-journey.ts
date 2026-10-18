import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { focusQuery } from "@/lib/focus-store";
import { fetchAll } from "@/lib/fetch-all";
import { dayPipeline, isBlocked, pipelineState, type DayPipeline, type PipelineState } from "@/lib/day-pipeline";
import { journeyFromPipeline, type Journey } from "@/lib/journey";
import {
  activeSessionQuery,
  rulesQuery,
  settingsQuery,
  strategiesQuery,
  todayPlanQuery,
  tradesQuery,
} from "@/lib/queries";

export { isBlocked };

/**
 * Sessions of the last two days, newest first; the pipeline narrows them to the trader's
 * today (his zone lives in settings, which this query can't see). Invalidated with ["sessions"].
 */
export const todaySessionsQuery = {
  queryKey: ["sessions", "today"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("trading_sessions")
      .select("id,started_at,ended_at")
      .gte("started_at", new Date(Date.now() - 2 * 86_400_000).toISOString())
      .order("started_at", { ascending: false });
    if (error) throw error;
    return data;
  },
} as const;

/** Trades reviewed since the cutoff; read only while the review rule is on (reviews_since set). */
export const reviewedTradesQuery = (since: string | null | undefined) =>
  queryOptions({
    queryKey: ["trade_reviews", "reviewed", since ?? null],
    enabled: !!since,
    queryFn: async () => {
      const rows = await fetchAll((from, to) =>
        supabase.from("trade_reviews").select("trade_id").not("trade_id", "is", null).gte("created_at", since!).order("id").range(from, to),
      );
      return rows.flatMap((x) => (x.trade_id ? [x.trade_id] : []));
    },
  });

/**
 * The day pipeline from cached queries; null while anything is still loading. The breaker
 * runs on these rows (partial trims and latched halts come with T21/T23); weekly reviews
 * stay untracked until T30 can write them, so a due week can't become a dead end.
 */
export function usePipeline(): { state: PipelineState; pipeline: DayPipeline } | null {
  const s = useQuery(settingsQuery);
  const t = useQuery(tradesQuery);
  const st = useQuery(strategiesQuery);
  const r = useQuery(rulesQuery);
  const f = useQuery(focusQuery);
  const today = useQuery(todaySessionsQuery);
  const open = useQuery(activeSessionQuery);
  const plan = useQuery({ ...todayPlanQuery(s.data?.timezone), enabled: !!s.data });
  const since = s.data?.reviews_since ?? null;
  const reviewed = useQuery(reviewedTradesQuery(since));
  if (!s.data || !t.data || !st.data || !r.data || !f.data || !today.data) return null;
  if (open.data === undefined || plan.data === undefined || (since && !reviewed.data && !reviewed.isError)) return null;

  const state = pipelineState({
    // A failed review read switches the review rule off rather than calling every close unreviewed.
    settings: reviewed.isError ? { ...s.data, reviews_since: null } : s.data,
    trades: t.data,
    plan: plan.data,
    sessions: open.data ? [open.data, ...today.data] : today.data,
    focus: f.data,
    strategies: st.data.length,
    rules: r.data.filter((x) => x.active).length,
    reviewedTradeIds: reviewed.data ?? [],
    weeklyReviewKeys: null,
  });
  return { state, pipeline: dayPipeline(state) };
}

/** The client's steps (nav dot) from the same pipeline. */
export function useJourney(): { journey: Journey; pipeline: DayPipeline } | null {
  const p = usePipeline();
  return p && { journey: journeyFromPipeline(p.pipeline), pipeline: p.pipeline };
}
