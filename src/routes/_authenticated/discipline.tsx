import { StreakCard } from "@/components/streak-card";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Loading, Stat } from "@/components/app-shell";
import { useCallback, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { SessionAgent } from "@/components/session-agent";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { disciplineMorning } from "@/lib/ai.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { currentUserId, settingsQuery, tradesQuery, violationsQuery } from "@/lib/queries";
import { disciplineReport } from "@/lib/stats";
import { countConsecutiveLosses } from "@/lib/trading-status";
import { Gauge, ShieldAlert, Sparkles, Clock, AlertTriangle, CheckCircle2, Info } from "lucide-react";

export const Route = createFileRoute("/_authenticated/discipline")({
  head: () => ({
    meta: [
      { title: "الانضباط والطمع — نظام هادي" },
      { name: "description", content: "حارس الانضباط: يسألك عن خطتك كل يوم ويكشف الطمع والانتقام." },
      { property: "og:title", content: "حارس الانضباط — نظام هادي" },
      { property: "og:description", content: "حارس الانضباط: يسألك عن خطتك كل يوم ويكشف الطمع والانتقام." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DisciplinePage,
});

export const DISCIPLINE_THREAD = "حارس الانضباط";
const GREETING = "هلا هادي، أنا **حارس الانضباط**.\n\nكل يوم بسألك: كم هدفك؟ كم صفقة بتاخذ؟ كم ستوبك؟ وبمسكك على خطتك طول اليوم.\n\nوقل لي **كيف تبيني أكون**: صارم ولا لطيف، ومتى أذكّرك — وأنا أمشي على كلامك.";
const QUICK = ["كيف تبيني أكون؟", "خطتي اليوم", "ذكّرني قبل الجلسة", "أحس بطمع", "حطني على تهدئة", "راجع يومي"];

function DisciplinePage() {
  const qc = useQueryClient();
  const morning = useServerFn(disciplineMorning);
  const asked = useRef(false);
  const onReady = useCallback((threadId: string) => {
    if (asked.current) return;
    asked.current = true;
    morning({ data: { threadId, day: new Date().toLocaleDateString("en-CA") } })
      .then((r) => { if (r && !r.skipped) qc.invalidateQueries({ queryKey: ["messages", threadId] }); })
      .catch(() => {});
  }, [morning, qc]);
  return (
    <div className="agent-page mx-auto w-full max-w-4xl">
      <div className="mb-2 grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Gauge className="size-5 shrink-0" />
          <h1 className="truncate font-display text-lg font-semibold lg:text-xl">حارس الانضباط</h1>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button size="icon" variant="secondary" className="size-9 rounded-full" aria-label="أرقامي"><ShieldAlert className="size-4" /></Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[92%] overflow-y-auto sm:max-w-xl">
            <SheetHeader><SheetTitle>أرقامي</SheetTitle></SheetHeader>
            <div className="mt-4"><DisciplineStats /></div>
          </SheetContent>
        </Sheet>
      </div>
      <div className="mb-2 shrink-0"><StreakCard compact /></div>
      <SessionAgent
        hasActive={false}
        title={DISCIPLINE_THREAD}
        greeting={GREETING}
        quick={QUICK}
        mode="discipline"
        placeholder="قل لحارس الانضباط خطتك…"
        onReady={onReady}
        onChanged={() => qc.invalidateQueries()}
      />
    </div>
  );
}

function DisciplineStats() {
  const qc = useQueryClient();
  const s = useQuery(settingsQuery);
  const t = useQuery(tradesQuery);
  const v = useQuery(violationsQuery);
  const [mins, setMins] = useState<number | "">("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const i = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 1000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    if (s.data && mins === "") setMins(s.data.cooldown_minutes || 30);
  }, [s.data, mins]);

  if (s.isLoading || t.isLoading || v.isLoading) return <Loading />;

  const trades = t.data ?? [];
  const violations = v.data ?? [];
  const settings = s.data!;

  const rep = disciplineReport(trades, violations, Number(settings.max_risk_per_trade) || 0);
  const until = settings.cooldown_until ? new Date(settings.cooldown_until).getTime() : 0;
  const left = Math.max(0, until - now);
  const streak = countConsecutiveLosses(
    trades.map((x) => ({
      status: x.status,
      pnl: x.pnl == null ? null : Number(x.pnl),
      opened_at: x.opened_at,
      closed_at: x.closed_at,
      risk_amount: x.risk_amount,
    }))
  );
  const maxStreak = settings.max_consecutive_losses ?? 0;

  // Additional discipline calculations
  const tradesWithSL = trades.filter((x) => x.stop_loss != null && x.stop_loss > 0).length;
  const slRate = trades.length > 0 ? Math.round((tradesWithSL / trades.length) * 100) : 100;

  async function saveCooldown(patch: { cooldown_until?: string | null; cooldown_minutes?: number }) {
    const user_id = await currentUserId();
    const { error } = await supabase.from("trading_settings").update(patch).eq("user_id", user_id);
    if (error) {
      toast.error("تعذر تحديث فترة التهدئة");
      return;
    }
    qc.invalidateQueries({ queryKey: ["settings"] });
  }

  const m = Number(mins) || 30;
  const fmt = (ms: number) => {
    const sec = Math.ceil(ms / 1000);
    return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
  };

  return (
    <div className="space-y-6">

      {/* COOLDOWN INTERVENTION PANEL */}
      <div className="panel p-6 space-y-4 border-2 border-border/80">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="size-5 text-primary" />
            <h2 className="font-bold text-base">فترة التهدئة الإلزامية (Cooldown)</h2>
          </div>
          {left > 0 && (
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-warning/10 text-warning animate-pulse">
              التهدئة جارية
            </span>
          )}
        </div>

        {left > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-warning/40 bg-warning/5 p-4">
            <div>
              <p className="text-xs text-muted-foreground">التداول موقوف لحمايتك من القرارات الانفعالية حتى نهاية العداد:</p>
              <p className="font-data mt-1 text-4xl font-bold tracking-tight text-warning" dir="ltr">
                {fmt(left)}
              </p>
            </div>
            <Button variant="secondary" onClick={() => saveCooldown({ cooldown_until: null })}>
              إنهاء التهدئة مبكراً
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              إذا شعرت بتوتر، أو بعد خسارتين متتاليتين، خذ استراحة فورية. التهدئة تمنع فتح الصفقات من شاشة الصفقة الجديدة.
            </p>
            <div className="flex flex-wrap items-end gap-3 pt-1">
              <div className="space-y-1">
                <Label className="text-xs">مدة التهدئة (دقائق)</Label>
                <Input
                  type="number"
                  min={5}
                  className="w-32 font-data"
                  value={mins}
                  onChange={(e) => setMins(e.target.value === "" ? "" : Number(e.target.value))}
                />
              </div>
              <Button
                onClick={() =>
                  saveCooldown({
                    cooldown_minutes: m,
                    cooldown_until: new Date(Date.now() + m * 60000).toISOString(),
                  })
                }
              >
                بدء فترة تهدئة الآن
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  saveCooldown({ cooldown_minutes: m }).then(() => toast.success("حُفظت المدة الافتراضية"))
                }
              >
                تعيين كمدة افتراضية
              </Button>
            </div>
          </div>
        )}

        {maxStreak > 0 && streak >= 2 && left === 0 && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3.5 text-xs text-destructive flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" />
              <span>لديك {streak} خسائر متتالية. ننصحك بقوة ببدء فترة تهدئة 20 دقيقة قبل فتح أي صفقة جديدة.</span>
            </div>
            <Button
              size="sm"
              variant="destructive"
              onClick={() =>
                saveCooldown({
                  cooldown_minutes: 20,
                  cooldown_until: new Date(Date.now() + 20 * 60000).toISOString(),
                })
              }
            >
              تهدئة 20 دقيقة
            </Button>
          </div>
        )}
      </div>

      {/* DISCIPLINE SCORE & BREAKDOWN */}
      {rep.score == null ? (
        <p className="panel p-5 text-center text-sm text-muted-foreground">لا توجد بيانات بعد. سجّل أول صفقة وتطلع درجتك هنا.</p>
      ) : (
        /* REAL DISCIPLINE STATS */
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat
              label="درجة الانضباط"
              value={`${rep.score}/100`}
              tone={rep.score >= 80 ? "success" : rep.score < 60 ? "destructive" : "warning"}
            />
            <Stat
              label="الالتزام بوقف الخسارة"
              value={`${slRate}%`}
              tone={slRate >= 90 ? "success" : "destructive"}
            />
            <Stat
              label="الالتزام بقائمة التحقق"
              value={`${Math.round(rep.checklistRate)}%`}
            />
            <Stat
              label="تداول انتقامي محتمل"
              value={rep.revenge}
              tone={rep.revenge > 0 ? "destructive" : undefined}
            />
            <Stat
              label="صفقات بمشاعر طمع"
              value={rep.greedy}
              tone={rep.greedy > 0 ? "warning" : undefined}
            />
          </div>

          {/* RATIONALE BEHIND SCORE */}
          <div className="panel p-6 space-y-4">
            <h3 className="font-bold text-base flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <span>السبب والتفسير الموضوعي لدرجة الانضباط ({rep.score}/100)</span>
            </h3>

            <div className="rounded-lg bg-muted/40 p-4 text-sm leading-relaxed text-foreground/90 space-y-2">
              <p>
                تم احتساب درجتك استناداً إلى تحليل {trades.length} صفقات مسجلة ومقارنتها بقواعدك:
              </p>
              <ul className="list-disc list-inside space-y-1 text-xs text-muted-foreground pr-2">
                <li>
                  الالتزام بوقف الخسارة: {tradesWithSL} من أصل {trades.length} صفقات تضمنت وقف خسارة مسبق ({slRate}%).
                </li>
                <li>
                  إكمال قائمة التحقق قبل الدخول: {Math.round(rep.checklistRate)}% من صفقاتك استوفت كافة الشروط.
                </li>
                {rep.revenge > 0 ? (
                  <li className="text-destructive font-medium">
                    خصم {rep.revenge * 5} نقاط بسبب {rep.revenge} صفقات فُتحت مباشرة خلال 15 دقيقة بعد خسارة (سلوك انتقامي).
                  </li>
                ) : (
                  <li className="text-success font-medium">
                    صفر صفقات انتقامية بعد الخسائر (تحكم انفعالي ممتاز).
                  </li>
                )}
                {rep.overRisk > 0 && (
                  <li className="text-destructive font-medium">
                    خصم {rep.overRisk * 5} نقاط لتجاوز سقف المخاطرة المسموح للصفقة الواحدة في {rep.overRisk} صفقات.
                  </li>
                )}
                {violations.length > 0 && (
                  <li className="text-destructive">
                    تم قيد {violations.length} مخالفات استثنائية مسجلة في السجل.
                  </li>
                )}
              </ul>
            </div>

            {/* Behavioral Signals */}
            <div className="pt-2">
              <h4 className="font-semibold text-xs text-muted-foreground mb-2">إشارات السلوك المسجلة:</h4>
              {rep.signals.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-success">
                  <CheckCircle2 className="size-4" />
                  <span>لا توجد أي إشارات سلبية. سلوكك التداولي يتسم بالانضباط والهدوء.</span>
                </div>
              ) : (
                <ul className="space-y-2 text-xs">
                  {rep.signals.map((sig, i) => (
                    <li key={i} className="flex items-start gap-2 text-foreground/90">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-destructive" />
                      <span>{sig}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

