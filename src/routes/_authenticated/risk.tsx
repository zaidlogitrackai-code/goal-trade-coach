import { useCallback, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ShieldCheck, SlidersHorizontal } from "lucide-react";
import { LimitsForm } from "@/components/limits-form";
import { RiskGuardian } from "@/components/risk-guardian";
import { Loading } from "@/components/app-shell";
import { SessionAgent } from "@/components/session-agent";
import { RISK_THREAD } from "@/components/risk-watcher";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { settingsQuery, tradesQuery, violationsQuery } from "@/lib/queries";
import { computeDayMetrics, computeStatus, startOfToday } from "@/lib/trading-status";
import { riskMorning } from "@/lib/ai.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/risk")({
  head: () => ({
    meta: [
      { title: "حارس المخاطر — نظام هادي للتداول" },
      { name: "description", content: "سولف مع حارس المخاطر: يراقب حدودك وينبهك وينصحك كل يوم." },
      { property: "og:title", content: "حارس المخاطر — نظام هادي" },
      { property: "og:description", content: "سولف مع حارس المخاطر: يراقب حدودك وينبهك وينصحك كل يوم." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RiskPage,
});

const GREETING = "هلا هادي، أنا **حارس المخاطر**.\n\nأراقب حدودك كل دقيقة وأنبهك هنا. قل لي أي شيء: \"كم باقي لي اليوم؟\"، \"خلّ حد الخسارة 150\"، أو وصف صفقة تبي تدخلها وأعطيك رأيي.";
const QUICK = ["كم باقي لي اليوم؟", "أبي أدخل صفقة", "عدّل حدودي", "صحّح التعارض"];

function RiskPage() {
  const s = useQuery(settingsQuery);
  const t = useQuery(tradesQuery);
  const v = useQuery(violationsQuery);
  const qc = useQueryClient();
  const morning = useServerFn(riskMorning);
  const asked = useRef(false);

  const onReady = useCallback((threadId: string) => {
    if (asked.current) return;
    asked.current = true;
    const day = new Date().toLocaleDateString("en-CA");
    morning({ data: { threadId, day } })
      .then((r) => { if (r && !r.skipped) qc.invalidateQueries({ queryKey: ["messages", threadId] }); })
      .catch(() => {});
  }, [morning, qc]);

  if (s.isLoading || t.isLoading) return <Loading />;
  const data = s.data ?? null;

  let tone = "bg-success", label = "سليمة";
  if (data) {
    const start = startOfToday().getTime();
    const vt = (v.data ?? []).filter((x) => new Date(x.occurred_at).getTime() >= start).length;
    const st = computeStatus(data, computeDayMetrics(data, t.data ?? [], vt));
    if (["loss_limit", "stopped", "high_risk", "rules_broken"].includes(st)) { tone = "bg-destructive"; label = "وقف"; }
    else if (st === "caution") { tone = "bg-warning"; label = "انتبه"; }
    else if (st === "target_hit") { tone = "bg-success"; label = "حققت هدفك"; }
  }

  async function togglePause() {
    if (!data) return;
    const { error } = await supabase.from("trading_settings").update({ trading_paused: !data.trading_paused }).eq("user_id", data.user_id);
    if (error) { toast.error("تعذر التحديث"); return; }
    qc.invalidateQueries({ queryKey: ["settings"] });
    toast.success(data.trading_paused ? "تم استئناف التداول" : "تم إيقاف التداول");
  }

  return (
    <div className="agent-page mx-auto w-full max-w-4xl">
      <div className="mb-2 grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <ShieldCheck className="size-5 shrink-0" />
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg font-semibold lg:text-xl">حارس المخاطر</h1>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`size-2 rounded-full ${tone}`} /> حالة اليوم: {label}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant={data?.trading_paused ? "default" : "destructive"} onClick={togglePause}>
            {data?.trading_paused ? "استئناف" : "إيقاف التداول"}
          </Button>
          <Sheet>
            <SheetTrigger asChild>
              <Button size="icon" variant="secondary" className="size-9 rounded-full" aria-label="حدودي"><SlidersHorizontal className="size-4" /></Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[92%] overflow-y-auto sm:max-w-xl">
              <SheetHeader><SheetTitle>حدودي</SheetTitle></SheetHeader>
              <div className="mt-4 space-y-4">
                <RiskGuardian settings={data} />
                <details className="panel p-4">
                  <summary className="cursor-pointer text-sm font-medium">تعديل يدوي (اختياري)</summary>
                  <div className="mt-4"><LimitsForm key={data?.updated_at} initial={data} submitLabel="حفظ التغييرات" /></div>
                </details>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
      <SessionAgent
        hasActive={false}
        title={RISK_THREAD}
        greeting={GREETING}
        quick={QUICK}
        mode="risk"
        placeholder="اكتب لحارس المخاطر…"
        onReady={onReady}
        onChanged={() => qc.invalidateQueries({ queryKey: ["settings"] })}
      />
    </div>
  );
}
