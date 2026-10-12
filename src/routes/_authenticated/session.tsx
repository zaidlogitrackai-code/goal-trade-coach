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
import { Activity, History, PauseCircle, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

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
    const i = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 1000);
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

  const past = (ss.data ?? []).filter((x) => x.ended_at);
  const historyList = past.length === 0 ? (
    <EmptyState text="جلساتك السابقة ومراجعاتها تظهر هنا." />
  ) : (
    <div className="space-y-3">
      {past.map((sess) => {
        const tr = (t.data ?? []).filter((x) => x.status === "closed" && x.closed_at && x.closed_at >= sess.started_at && x.closed_at <= sess.ended_at!);
        const pnl = tr.reduce((acc, y) => acc + (Number(y.pnl) || 0), 0);
        const durationMs = +new Date(sess.ended_at!) - +new Date(sess.started_at);
        return (
          <div key={sess.id} className="rounded-2xl border border-border/60 bg-muted/20 p-3.5 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold">{fmtDate(sess.started_at)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{durationStr(durationMs)} · {sess.mood} · {tr.length} صفقات</p>
              </div>
              <div className="flex items-center gap-1">
                <span dir="ltr" className={`font-data font-bold ${pnl > 0 ? "text-success" : pnl < 0 ? "text-destructive" : ""}`}>{fmtMoney(pnl, cur)}</span>
                <Button size="icon" variant="ghost" className="size-8 text-muted-foreground" aria-label="حذف الجلسة" onClick={() => deleteSession(sess.id)}><Trash2 className="size-4" /></Button>
              </div>
            </div>
            {(sess.plan || sess.review) && (
              <details className="mt-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer select-none text-foreground/80">الخطة والمراجعة</summary>
                {sess.plan && <p className="mt-2 whitespace-pre-wrap leading-relaxed">{sess.plan}</p>}
                {sess.review && <p className="mt-2 whitespace-pre-wrap border-t border-border/40 pt-2 leading-relaxed text-foreground/90">{sess.review}</p>}
              </details>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="agent-page mx-auto w-full max-w-3xl">
      <div className="hidden shrink-0 lg:block">
        <PageHeader title="جلسة التداول" subtitle="المساعد ينظم جلستك: يسألك عن تارقتك، يبدأ الجلسة، ويسوي المراجعة لما تخلص." />
      </div>

      {/* Top bar: title + history */}
      <div className="flex shrink-0 items-center justify-between gap-2 pb-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold lg:hidden">جلسة التداول</p>
          {active ? (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-success animate-pulse" />
              <span>شغالة</span>
              <span dir="ltr" className="font-data">{new Date(now - +new Date(active.started_at)).toISOString().slice(11, 19)}</span>
              <span>·</span>
              <span dir="ltr" className={`font-data ${sessionPnl > 0 ? "text-success" : sessionPnl < 0 ? "text-destructive" : ""}`}>{fmtMoney(sessionPnl, cur)}</span>
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">ما في جلسة مفتوحة</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {active && (
            <Sheet>
              <SheetTrigger asChild>
                <Button size="icon" variant="ghost" aria-label="تفاصيل الجلسة"><Activity className="size-5" /></Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-3xl">
                <SheetHeader><SheetTitle className="text-right">الجلسة الحالية</SheetTitle></SheetHeader>
                <div className="mt-4 space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label="صفقات الجلسة" value={sessionTrades.length} />
                    <Stat label="مخاطرة الجلسة" value={fmtMoney(sessionRiskUsed, cur)} />
                    <Stat label="المتبقي من المخاطرة" value={dayMetrics.riskRemaining != null ? fmtMoney(dayMetrics.riskRemaining, cur) : "غير محدد"} />
                    <Stat label="خسائر متتالية" value={dayMetrics.consecutiveLosses} tone={dayMetrics.consecutiveLosses > 0 ? "warning" : undefined} />
                  </div>
                  {active.plan && (
                    <div className="rounded-2xl border border-border/60 bg-muted/20 p-3 text-xs">
                      <p className="mb-1 font-semibold">خطة الجلسة</p>
                      <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">{active.plan}</p>
                    </div>
                  )}
                  <Button variant={settings.trading_paused ? "default" : "destructive"} className="w-full gap-1.5" onClick={togglePause}>
                    <PauseCircle className="size-4" />{settings.trading_paused ? "استئناف التداول" : "إيقاف التداول"}
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
          )}
          <Sheet>
            <SheetTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="سجل الجلسات"><History className="size-5" /></Button>
            </SheetTrigger>
            <SheetContent side="right" className="flex w-[88%] flex-col gap-4 overflow-y-auto sm:max-w-md">
              <SheetHeader><SheetTitle className="pr-8 text-right">سجل الجلسات</SheetTitle></SheetHeader>
              {historyList}
            </SheetContent>
          </Sheet>
        </div>
      </div>

      <SessionAgent hasActive={!!active} onChanged={() => { qc.invalidateQueries({ queryKey: ["sessions"] }); qc.invalidateQueries({ queryKey: ["settings"] }); qc.invalidateQueries({ queryKey: ["trades"] }); }} />
    </div>
  );
}

export default SessionPage;
