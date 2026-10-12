import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false, refetchIntervalInBackground: false } },
  });
  // Limits are % of the live balance: when trades or capital change, refresh settings too.
  queryClient.getQueryCache().subscribe((e) => {
    if (e.type !== "updated" || e.action.type !== "success") return;
    const k = e.query.queryKey[0];
    if (k === "capital" || k === "trades") void queryClient.invalidateQueries({ queryKey: ["settings"], exact: true });
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
