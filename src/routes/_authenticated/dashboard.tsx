import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { settingsQuery, tradesQuery, violationsQuery, todayPlanQuery } from "@/lib/queries";
import { effectiveDailyTarget } from "@/lib/daily-plan";
import { computeDayMetrics } from "@/lib/trading-status";
import { dayStart, safeTz } from "@/lib/trading-day";
import { CoreMetrics } from "@/components/dashboard/core-metrics";
import { DayFlow } from "@/components/dashboard/day-flow";
import { flowFromPipeline } from "@/lib/day-flow";
import { usePipeline } from "@/lib/use-journey";
import { RefreshCw, AlertCircle } from "lucide-react";
import { OpenTrades } from "@/components/dashboard/open-trades";
import { QuickCoach } from "@/components/dashboard/quick-coach";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "حالة التداول اليوم — نظام هادي" },
      { name: "description", content: "خطوتك التالية اليوم، وسَنَد يمشّيك فيها." },
      { property: "og:title", content: "حالة التداول اليوم — نظام هادي" },
      { property: "og:description", content: "خطوتك التالية اليوم، وسَنَد يمشّيك فيها." },
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
  const plan = useQuery({ ...todayPlanQuery(s.data?.timezone), enabled: !!s.data });
  // The step comes from the one day engine, the same one behind the nav dot and سَنَد's line.
  const pipeline = usePipeline();

  if (s.isLoading || t.isLoading || v.isLoading) {
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
        <Button onClick={() => { s.refetch(); t.refetch(); v.refetch(); }} className="gap-2">
          <RefreshCw className="size-4" /> إعادة المحاولة
        </Button>
      </div>
    );
  }

  const settings = { ...s.data, daily_target: effectiveDailyTarget(plan.data?.target, s.data.daily_target) };
  const trades = t.data ?? [];
  const start = dayStart(new Date(), settings.timezone).getTime();
  const violationsToday = (v.data ?? []).filter((x) => new Date(x.occurred_at).getTime() >= start).length;
  const metrics = computeDayMetrics(settings, trades, violationsToday);
  const flow = pipeline && flowFromPipeline(pipeline.pipeline);

  return (
    <div className="mx-auto max-w-5xl space-y-5 lg:space-y-6">
      <PageHeader
        title="يومك"
        subtitle={new Intl.DateTimeFormat("ar-SA-u-nu-latn", { dateStyle: "full", timeZone: safeTz(settings.timezone) }).format(new Date())}
      />
      {flow ? <DayFlow flow={flow} /> : <Skeleton className="h-36 w-full rounded-2xl" />}
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
