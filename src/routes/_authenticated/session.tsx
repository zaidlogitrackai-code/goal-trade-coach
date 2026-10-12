import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, Loading, PageHeader, Stat } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { SessionAgent } from "@/components/session-agent";
import { fmtDate, fmtMoney, settingsQuery, tradesQuery } from "@/lib/queries";
import { computeDayMetrics, startOfToday } from "@/lib/trading-status";
import { PauseCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/session")({
  head: () => ({
    meta: [
      { title: "جلسة التداول — نظام هادي" },
      { name: "description", content: "خطة واضحة قبل التداول، مراقبة فورية أثناء الجلسة، ومراجعة مهيكلة بعد الإغلاق." },
    ],
  }),
  component: SessionPage,
});


function SessionPage() {
  const qc = useQueryClient();
  const t = useQuery(tradesQuery);
  const s = useQuery(settingsQuery);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  const ss = useQuery({
    queryKey: ["sessions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trading_sessions")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
  });

  if (ss.isLoading || s.isLoading || t.isLoading) return <Loading />;

  const settings = s.data!;
  const cur = settings.currency ?? "USD";
  const active = ss.data?.find((x) => !x.ended_at);

  const startOfDay = startOfToday().getTime();
  const dayMetrics = computeDayMetrics(settings, t.data ?? [], 0);

  // Filter trades that belong to the active session
  const sessionTrades = active
    ? (t.data ?? []).filter(
        (x) => new Date(x.opened_at).getTime() >= new Date(active.started_at).getTime()
      )
    : [];

  const closedSessionTrades = sessionTrades.filter((x) => x.status === "closed");
  const sessionPnl = closedSessionTrades.reduce((acc, x) => acc + (Number(x.pnl) || 0), 0);
  const sessionRiskUsed = sessionTrades.reduce((acc, x) => acc + (Number(x.risk_amount) || 0), 0);

  async function deleteSession(id: string) {
    if (!confirm("حذف هذه الجلسة من السجل؟")) return;
    await supabase.from("trading_sessions").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["sessions"] });
    toast.success("تم حذف الجلسة");
  }

  async function togglePause() {
    const { error } = await supabase
      .from("trading_settings")
      .update({ trading_paused: !settings.trading_paused })
      .eq("user_id", settings.user_id);
    if (error) {
      toast.error("تعذر تحديث الحالة");
      return;
    }
    qc.invalidateQueries({ queryKey: ["settings"] });
    toast.success(settings.trading_paused ? "تم استئناف التداول" : "تم إيقاف التداول مؤقتاً");
  }

  const durationStr = (ms: number) => {
    const mins = Math.floor(ms / 60000);
    const hrs = Math.floor(mins / 60);
    return `${hrs}س ${mins % 60}د`;
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        title="جلسة التداول"
        subtitle="المساعد ينظم جلستك: يسألك عن تارقتك، يبدأ الجلسة، ويسوي المراجعة لما تخلص."
      />

      {active ? (
        /* DURING SESSION */
        <div className="panel space-y-6 p-6 border-2 border-primary/40 bg-muted/10">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-5">
            <div>
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full bg-primary animate-pulse" />
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">جلسة تداول نشطة</p>
              </div>
              <p className="font-data mt-1 text-3xl font-bold tracking-tight" dir="ltr">
                {new Date(now - +new Date(active.started_at)).toISOString().slice(11, 19)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                بدأت في {fmtDate(active.started_at)} · المزاج: {active.mood}
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-left font-data">
                <p className="text-xs text-muted-foreground">ربح / خسارة الجلسة</p>
                <p
                  dir="ltr"
                  className={`text-2xl font-bold ${
                    sessionPnl > 0 ? "text-success" : sessionPnl < 0 ? "text-destructive" : "text-foreground"
                  }`}
                >
                  {fmtMoney(sessionPnl, cur)}
                </p>
              </div>

              <Button
                variant={settings.trading_paused ? "default" : "destructive"}
                size="sm"
                onClick={togglePause}
                className="gap-1.5"
              >
                <PauseCircle className="size-4" />
                {settings.trading_paused ? "استئناف" : "إيقاف التداول"}
              </Button>
            </div>
          </div>

          {/* Real-time Session Metrics */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="صفقات الجلسة" value={sessionTrades.length} />
            <Stat label="مخاطرة الجلسة" value={fmtMoney(sessionRiskUsed, cur)} />
            <Stat
              label="المخاطرة المتبقية اليوم"
              value={dayMetrics.riskRemaining != null ? fmtMoney(dayMetrics.riskRemaining, cur) : "غير محدد"}
            />
            <Stat
              label="الخسائر المتتالية"
              value={dayMetrics.consecutiveLosses}
              tone={dayMetrics.consecutiveLosses > 0 ? "warning" : undefined}
            />
          </div>

          {/* Written Plan */}
          {active.plan && (
            <div className="rounded-lg bg-card border border-border p-4 space-y-1 text-xs">
              <span className="font-semibold text-primary block">خطة الجلسة وشروطك المقررة:</span>
              <p className="whitespace-pre-wrap leading-relaxed text-foreground/90">{active.plan}</p>
            </div>
          )}

        </div>
      ) : null}

      <SessionAgent hasActive={!!active} onChanged={() => { qc.invalidateQueries({ queryKey: ["sessions"] }); qc.invalidateQueries({ queryKey: ["settings"] }); qc.invalidateQueries({ queryKey: ["trades"] }); }} />

      {/* PREVIOUS SESSIONS LIST */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold">سجل الجلسات السابقة</h2>
        {(ss.data ?? []).filter((x) => x.ended_at).length === 0 ? (
          <EmptyState text="جلساتك السابقة ومراجعاتها السلوكية تظهر هنا." />
        ) : (
          <div className="space-y-3">
            {ss.data!
              .filter((x) => x.ended_at)
              .map((sess) => {
                const tr = (t.data ?? []).filter(
                  (x) =>
                    x.status === "closed" &&
                    x.closed_at &&
                    x.closed_at >= sess.started_at &&
                    x.closed_at <= sess.ended_at!
                );
                const pnl = tr.reduce((acc, y) => acc + (Number(y.pnl) || 0), 0);
                const durationMs = +new Date(sess.ended_at!) - +new Date(sess.started_at);

                return (
                  <div key={sess.id} className="panel p-5 space-y-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2">
                      <div className="space-y-0.5">
                        <span className="font-semibold text-foreground">
                          {fmtDate(sess.started_at)}
                        </span>
                        <span className="text-xs text-muted-foreground block">
                          المدة: {durationStr(durationMs)} · المزاج: {sess.mood} · صفقات: {tr.length}
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        <span
                          dir="ltr"
                          className={`font-data text-base font-bold ${
                            pnl >= 0 ? "text-success" : "text-destructive"
                          }`}
                        >
                          {fmtMoney(pnl, cur)}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteSession(sess.id)}
                          className="text-xs text-destructive hover:bg-destructive/10"
                        >
                          حذف
                        </Button>
                      </div>
                    </div>

                    {sess.plan && (
                      <div className="text-xs text-muted-foreground bg-muted/20 p-2.5 rounded-lg space-y-0.5">
                        <span className="font-semibold text-primary block">الخطة المكتوبة:</span>
                        <p className="whitespace-pre-wrap">{sess.plan}</p>
                      </div>
                    )}

                    {sess.review && (
                      <div className="text-xs bg-muted/40 p-2.5 rounded-lg space-y-0.5">
                        <span className="font-semibold text-foreground block">المراجعة والتقييم:</span>
                        <p className="whitespace-pre-wrap">{sess.review}</p>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}

export default SessionPage;
