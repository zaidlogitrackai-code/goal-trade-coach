import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, EmptyState } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { settingsQuery, strategiesQuery, tradesQuery, violationsQuery, fmtMoney } from "@/lib/queries";
import { computeDayMetrics, computeStatus, startOfToday } from "@/lib/trading-status";
import { disciplineReport } from "@/lib/stats";
import { supabase } from "@/integrations/supabase/client";
import { StatusBanner, type BannerStatusCode } from "@/components/dashboard/status-banner";
import { CoreMetrics } from "@/components/dashboard/core-metrics";
import { LimitsProgress } from "@/components/dashboard/limits-progress";
import { SessionWidget } from "@/components/dashboard/session-widget";
import { BehaviorWidget } from "@/components/dashboard/behavior-widget";
import { ActivityList, type ActivityFeedItem } from "@/components/dashboard/activity-list";
import { FocusCard } from "@/components/dashboard/focus-card";
import { JourneySteps } from "@/components/dashboard/journey-steps";
import { CapitalCard } from "@/components/dashboard/capital-card";
import { useJourney } from "@/lib/use-journey";
import { RefreshCw, AlertCircle, PlusCircle, ChevronDown } from "lucide-react";
import { QuickCoach } from "@/components/dashboard/quick-coach";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "حالة التداول اليوم — نظام هادي" },
      { name: "description", content: "شاشة القرار اليومية: هل مسموح لك بالتداول وما هي خطوتك التالية؟" },
    ],
  }),
  component: Dashboard,
});

function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex justify-between items-center">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-10 w-32" />
      </div>
      <Skeleton className="h-44 w-full rounded-2xl" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </div>
  );
}

function Dashboard() {
  const s = useQuery(settingsQuery);
  const t = useQuery(tradesQuery);
  const v = useQuery(violationsQuery);
  const strategies = useQuery(strategiesQuery);
  const journey = useJourney();
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trading_sessions")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });

  const isLoading = s.isLoading || t.isLoading || v.isLoading || sessions.isLoading;
  const isError = s.isError || t.isError;

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (isError || !s.data) {
    return (
      <div className="mx-auto max-w-4xl py-12 text-center space-y-4">
        <div className="panel p-8 space-y-4 max-w-lg mx-auto border-destructive/40 bg-destructive/5">
          <AlertCircle className="size-10 mx-auto text-destructive" />
          <h2 className="text-xl font-bold">تعذر تحميل بيانات الداشبورد</h2>
          <p className="text-sm text-muted-foreground">
            بياناتك محفوظة بأمان. حدث خطأ أثناء الاتصال بقاعدة البيانات.
          </p>
          <Button
            onClick={() => {
              s.refetch();
              t.refetch();
              v.refetch();
              sessions.refetch();
            }}
            className="gap-2"
          >
            <RefreshCw className="size-4" />
            إعادة المحاولة
          </Button>
        </div>
      </div>
    );
  }

  const settings = s.data;
  const allTrades = t.data ?? [];
  const allViolations = v.data ?? [];
  const allSessions = sessions.data ?? [];

  const start = startOfToday().getTime();
  const violationsToday = allViolations.filter((x) => new Date(x.occurred_at).getTime() >= start).length;
  const metrics = computeDayMetrics(settings, allTrades, violationsToday);
  const rawStatus = computeStatus(settings, metrics);

  // Active Session
  const activeSession = allSessions.find((x) => !x.ended_at) ?? null;
  const sessionTrades = activeSession
    ? allTrades.filter(
        (x) => new Date(x.opened_at).getTime() >= new Date(activeSession.started_at).getTime()
      )
    : [];
  const sessionPnl = sessionTrades
    .filter((x) => x.status === "closed")
    .reduce((acc, x) => acc + (x.pnl ?? 0), 0);

  // Determine Banner Status
  let bannerStatus: BannerStatusCode = rawStatus as BannerStatusCode;
  if (!activeSession && rawStatus === "ready") {
    bannerStatus = "no_session";
  }

  // Discipline & Behavioral Metrics
  const discipline = disciplineReport(allTrades, allViolations, Number(settings.max_risk_per_trade) || 0);

  // Build Activity Feed (max 5 items)
  const activityItems: ActivityFeedItem[] = [];

  // Add recent sessions
  for (const sess of allSessions.slice(0, 3)) {
    activityItems.push({
      id: `sess-${sess.id}`,
      type: "session_start",
      title: sess.ended_at ? "جلسة تداول منتهية" : "جلسة تداول جارية",
      description: sess.mood ? `الحالة: ${sess.mood}` : "جلسة يومية",
      timestamp: sess.started_at,
      link: "/session",
    });
  }

  // Add recent trades
  for (const tr of allTrades.slice(0, 5)) {
    activityItems.push({
      id: `trade-${tr.id}`,
      type: tr.status === "closed" ? "trade_close" : "trade_open",
      title: `${tr.direction === "long" ? "شراء" : "بيع"} ${tr.symbol}`,
      description: tr.status === "closed" ? "تم إغلاق الصفقة" : "صفقة مفتوحة حالياً",
      timestamp: tr.closed_at ?? tr.opened_at,
      amount: tr.pnl,
      currency: settings.currency,
      link: "/trades",
    });
  }

  // Add recent violations
  for (const viol of allViolations.slice(0, 3)) {
    activityItems.push({
      id: `viol-${viol.id}`,
      type: "violation",
      title: "تسجيل مخالفة لقواعد التداول",
      description: viol.note || "مخالفة غير محددة",
      timestamp: viol.occurred_at,
      link: "/discipline",
    });
  }

  // Sort activities by timestamp descending
  activityItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const cur = settings.currency;
  const openTrades = allTrades.filter((x) => x.status === "open");

  return (
    <div className="mx-auto max-w-6xl space-y-5 sm:space-y-8">
      {/* 1. Header */}
      <PageHeader
        title="حالة التداول اليوم"
        subtitle={new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
          dateStyle: "full",
          timeZone: settings.timezone || undefined,
        }).format(new Date())}
        action={
          <div className="flex items-center gap-2">
            <Button asChild>
              <Link to="/new-trade">
                <PlusCircle className="size-4 ml-1.5" />
                صفقة جديدة
              </Link>
            </Button>
          </div>
        }
      />

      {/* 2. Main Status Banner (Single Primary Decision & Action) */}
      <StatusBanner
        status={bannerStatus}
        cooldownUntil={settings.cooldown_until}
        hasActiveSession={!!activeSession}
        consecutiveLosses={metrics.consecutiveLosses}
        maxConsecutiveLosses={settings.max_consecutive_losses}
      />

      {/* 3. Four Core Metric Cards */}
      <CoreMetrics
        todayPnl={metrics.todayPnl}
        dailyTarget={settings.daily_target}
        maxDailyProfit={settings.max_daily_profit}
        maxDailyLoss={settings.max_daily_loss}
        currency={cur}
        riskRemaining={metrics.riskRemaining}
        maxDailyRisk={settings.max_daily_risk}
        tradesRemaining={metrics.tradesRemaining}
        maxTradesPerDay={settings.max_trades_per_day}
        tradesToday={metrics.tradesToday}
        consecutiveLosses={metrics.consecutiveLosses}
        maxConsecutiveLosses={settings.max_consecutive_losses}
      />

      <QuickCoach needsGoals={[settings.daily_target, settings.weekly_target, settings.monthly_target, settings.max_daily_loss, settings.max_risk_per_trade].some((x) => !Number(x))} />

      <details className="group panel p-4 sm:p-5">
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium">
          تفاصيل أكثر
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-5 space-y-6">
      {/* 2.1 The client's steps: one clear next action */}
      {journey && <JourneySteps journey={journey.journey} />}

      {/* 2.2 Focus: what the trader told the coach, next to what their trades show */}
      <FocusCard trades={allTrades} strategies={strategies.data ?? []} currency={cur} />

      <CapitalCard currency={cur} />

      {/* 4. Limits Progress & Active Session Widget */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <LimitsProgress
          todayPnl={metrics.todayPnl}
          dailyTarget={settings.daily_target}
          maxDailyProfit={settings.max_daily_profit}
          maxDailyLoss={settings.max_daily_loss}
          riskUsed={metrics.riskUsed}
          maxDailyRisk={settings.max_daily_risk}
          tradesToday={metrics.tradesToday}
          maxTradesPerDay={settings.max_trades_per_day}
          consecutiveLosses={metrics.consecutiveLosses}
          maxConsecutiveLosses={settings.max_consecutive_losses}
          maxRiskPerTrade={settings.max_risk_per_trade}
          currency={cur}
        />

        <div className="space-y-6">
          <SessionWidget
            activeSession={activeSession}
            sessionTradesCount={sessionTrades.length}
            sessionPnl={sessionPnl}
            currency={cur}
          />

          <BehaviorWidget
            tradesCount={allTrades.length}
            revengeCount={discipline.revenge}
            greedyCount={discipline.greedy}
            checklistRate={discipline.checklistRate}
            disciplineScore={discipline.score}
          />
        </div>
      </div>

      {/* 5. Open Trades & Recent Activities */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Open Trades Card */}
        <div className="panel space-y-4 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">الصفقات المفتوحة حالياً</h2>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
              {openTrades.length} صفقات
            </span>
          </div>

          {openTrades.length === 0 ? (
            <EmptyState
              title="لا توجد صفقات مفتوحة"
              text={
                allTrades.length === 0
                  ? "ابدأ جلستك ثم سجّل قرارك الأول بانضباط."
                  : "جميع مراكزك مغلقة حالياً. لا تفتح صفقة إلا بإعداد مكتمل."
              }
            />
          ) : (
            <div className="space-y-3">
              {openTrades.map((x) => (
                <Link
                  key={x.id}
                  to="/trades"
                  className="flex items-center justify-between rounded-lg border border-border p-3.5 transition-colors hover:border-primary/50 bg-muted/20"
                >
                  <div className="space-y-1">
                    <p className="font-data font-semibold text-base" dir="ltr">
                      {x.symbol}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {x.direction === "long" ? "شراء (Long)" : "بيع (Short)"}
                      {x.entry_price != null ? ` · دخول: ${x.entry_price}` : ""}
                    </p>
                  </div>
                  <div className="text-left font-data text-xs text-muted-foreground" dir="ltr">
                    <span className="block font-medium text-foreground">
                      مخاطرة {fmtMoney(x.risk_amount, cur)}
                    </span>
                    {x.stop_loss != null ? (
                      <span className="text-[11px] text-destructive">وقف: {x.stop_loss}</span>
                    ) : (
                      <span className="text-[11px] text-destructive font-semibold">بدون وقف!</span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recent Activity List */}
        <ActivityList items={activityItems} />
      </div>
        </div>
      </details>
    </div>
  );
}

export default Dashboard;
