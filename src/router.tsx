import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    // No polling and no focus/reconnect refetches: the one heartbeat (src/hooks/use-resume.ts)
    // re-reads each visible minute and on resume, so nothing fetches twice for the same event.
    defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchIntervalInBackground: false } },
  });
  // Limits are % of the live balance: when trades or capital change, refresh settings too.
  // Only on a real change: structural sharing keeps the same data object when a refetch found
  // nothing new, and re-reading settings every minute for nothing cost three requests.
  const seen = new Map<string, unknown>();
  queryClient.getQueryCache().subscribe((e) => {
    if (e.type !== "updated" || e.action.type !== "success") return;
    const k = e.query.queryKey[0];
    if (k !== "capital" && k !== "trades") return;
    const before = seen.get(e.query.queryHash);
    const after = e.query.state.data;
    seen.set(e.query.queryHash, after);
    // The first read is not a change: settings reads trades and capital itself.
    if (before !== undefined && before !== after) void queryClient.invalidateQueries({ queryKey: ["settings"], exact: true });
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
