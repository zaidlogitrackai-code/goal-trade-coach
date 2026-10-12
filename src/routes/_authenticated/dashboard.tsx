import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { settingsQuery, tradesQuery, violationsQuery } from "@/lib/queries";
import { computeDayMetrics, computeStatus, startOfToday } from "@/lib/trading-status";
import { supabase } from "@/integrations/supabase/client";
import { CoreMetrics } from "@/components/dashboard/core-metrics";
import { DayFlow } from "@/components/dashboard/day-flow";
import { currentStep } from "@/lib/day-flow";
import { RefreshCw, AlertCircle } from "lucide-react";
import { OpenTrades } from "@/components/dashboard/open-trades";
import { QuickCoach } from "@/components/dashboard/quick-coach";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "حالة التداول اليوم — نظام هادي" },
      { name: "description", content: "خطوتك التالية اليوم، والمدرب الذكي يمشّيك فيها." },
      { property: "og:title", content: "حالة التداول اليوم — نظام هادي" },
      { property: "og:description", content: "خطوتك التالية اليوم، والمدرب الذكي يمشّيك فيها." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const s = useQuery(settingsQuery);
  const t = useQuery(tradesQuery);
  const v = useQuery(violationsQuery);
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("trading_sessions").select("*").order("started_at", { ascending: false }).limit(10);
      if (error) throw error;
      return data;
    },
  });

  if (s.isLoading || t.isLoading || v.isLoading || sessions.isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-5">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-36 w-full rounded-2xl" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      </div>
    );
  }

  if (s.isError || t.isError || !s.data) {
    return (
      <div className="panel mx-auto mt-12 max-w-lg space-y-4 p-8 text-center">
        <AlertCircle className="mx-auto size-10 text-destructive" />
        <h2 className="text-xl font-bold">تعذر تحميل البيانات</h2>
        <Button onClick={() => { s.refetch(); t.refetch(); v.refetch(); sessions.refetch(); }} className="gap-2">
          <RefreshCw className="size-4" /> إعادة المحاولة
        </Button>
      </div>
    );
  }

  const settings = s.data;
  const trades = t.data ?? [];
  const start = startOfToday().getTime();
  const violationsToday = (v.data ?? []).filter((x) => new Date(x.occurred_at).getTime() >= start).length;
  const metrics = computeDayMetrics(settings, trades, violationsToday);
  const status = computeStatus(settings, metrics);
  const all = sessions.data ?? [];
  const activeSession = all.find((x) => !x.ended_at) ?? null;
  const sessionEndedToday = all.some((x) => x.ended_at && new Date(x.ended_at).getTime() >= start);
  const hasGoals = [settings.daily_target, settings.max_daily_loss, settings.max_risk_per_trade].every((x) => Number(x) > 0);

  const flow = currentStep({
    hasGoals,
    status,
    hasActiveSession: !!activeSession,
    sessionEndedToday,
    openTradesWithoutStop: trades.filter((x) => x.status === "open" && x.stop_loss == null).length,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-5 lg:space-y-6">
      <PageHeader
        title="يومك"
        subtitle={new Intl.DateTimeFormat("ar-SA-u-nu-latn", { dateStyle: "full", timeZone: settings.timezone || undefined }).format(new Date())}
      />
      <DayFlow flow={flow} />
      <CoreMetrics
        todayPnl={metrics.todayPnl}
        dailyTarget={settings.daily_target}
        maxDailyProfit={settings.max_daily_profit}
        maxDailyLoss={settings.max_daily_loss}
        currency={settings.currency}
        riskRemaining={metrics.riskRemaining}
        maxDailyRisk={settings.max_daily_risk}
        tradesRemaining={metrics.tradesRemaining}
        maxTradesPerDay={settings.max_trades_per_day}
        tradesToday={metrics.tradesToday}
        consecutiveLosses={metrics.consecutiveLosses}
        maxConsecutiveLosses={settings.max_consecutive_losses}
      />
      <OpenTrades trades={trades} currency={settings.currency} />
      <QuickCoach />
    </div>
  );
}

export default Dashboard;
