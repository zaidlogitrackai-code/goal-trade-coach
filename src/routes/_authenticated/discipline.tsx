import { StreakCard } from "@/components/streak-card";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ChatHeader, Loading, Stat } from "@/components/app-shell";
import { useCallback, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAgentChats } from "@/components/agent-chats";
import { SessionAgent } from "@/components/session-agent";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { disciplineMorning } from "@/lib/ai.functions";
import { Button } from "@/components/ui/button";
import { NumberField } from "@/components/ui/number-field";
import { Label } from "@/components/ui/label";
import { currentUserId, fmtMoney, settingsQuery, tradesQuery, violationsQuery } from "@/lib/queries";
import { parseDecimal } from "@/lib/num";
import { dayKey } from "@/lib/trading-day";
import { cooldownMinutes, disciplineReport, WINDOW_DAYS } from "@/lib/discipline";
import { REVENGE_WINDOW_MIN } from "@/lib/emotions";
import { ShieldAlert, Sparkles, Clock, AlertTriangle, CheckCircle2, Info } from "lucide-react";

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
  const { c, controls } = useAgentChats(DISCIPLINE_THREAD, GREETING);
  const onReady = useCallback((threadId: string) => {
    if (asked.current) return;
    asked.current = true;
    // The once-a-day lock is keyed by the trader's own calendar day.
    qc.ensureQueryData(settingsQuery).catch(() => null)
      .then((st) => morning({ data: { threadId, day: dayKey(new Date(), st?.timezone) } }))
      .then((r) => { if (r && !r.skipped) qc.invalidateQueries({ queryKey: ["messages", threadId] }); })
      .catch(() => {});
  }, [morning, qc]);
  return (
    <div className="agent-page mx-auto w-full max-w-4xl">
      <ChatHeader
        actions={<>
          {controls}
          <Sheet>
            <SheetTrigger asChild>
              <Button size="icon" variant="secondary" className="size-9 rounded-full" aria-label="أرقامي"><ShieldAlert className="size-4" /></Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[92%] overflow-y-auto sm:max-w-xl">
              <SheetHeader><SheetTitle>أرقامي</SheetTitle></SheetHeader>
              <div className="mt-4"><DisciplineStats /></div>
            </SheetContent>
          </Sheet>
        </>}
      />
      <div className="mb-2 shrink-0"><StreakCard compact /></div>
      {c && <SessionAgent
        key={c}
        threadId={c}
        hasActive={false}
        title={DISCIPLINE_THREAD}
        greeting={GREETING}
        quick={QUICK}
        mode="discipline"
        placeholder="قل لحارس الانضباط خطتك…"
        onReady={onReady}
        onChanged={() => qc.invalidateQueries()}
      />}
    </div>
  );
}

function DisciplineStats() {
  const qc = useQueryClient();
  const s = useQuery(settingsQuery);
  const t = useQuery(tradesQuery);
  const v = useQuery(violationsQuery);
  // null until settings load, so clearing the field to retype doesn't snap back to the default.
  const [mins, setMins] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const i = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 1000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    if (s.data && mins === null) setMins(String(cooldownMinutes(s.data)));
  }, [s.data, mins]);

  // Not on the countdown's 1s tick: the report only changes with the data.
  const rep = useMemo(
    () =>
      disciplineReport(t.data ?? [], v.data ?? [], {
        maxRiskPerTrade: Number(s.data?.max_risk_per_trade) || 0,
        tz: s.data?.timezone,
        revengeWindowMin: REVENGE_WINDOW_MIN(s.data),
        cooldownMinutes: cooldownMinutes(s.data),
      }),
    [t.data, v.data, s.data],
  );

  if (s.isLoading || t.isLoading || v.isLoading) return <Loading />;

  const settings = s.data!;
  const cur = settings.currency;
  const until = settings.cooldown_until ? new Date(settings.cooldown_until).getTime() : 0;
  const left = Math.max(0, until - now);
  const cool = rep.interventions.find((x) => x.kind === "cooldown");
  const coolMin = cool?.minutes ?? cooldownMinutes(settings);
  const nudges = rep.interventions.filter((x) => x.kind !== "cooldown");
  const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x)}%`);
  const mt = rep.metrics;

  async function saveCooldown(patch: { cooldown_until?: string | null; cooldown_minutes?: number }) {
    const user_id = await currentUserId();
    const { error } = await supabase.from("trading_settings").update(patch).eq("user_id", user_id);
    if (error) {
      toast.error("تعذر تحديث فترة التهدئة");
      return;
    }
    qc.invalidateQueries({ queryKey: ["settings"] });
  }

  const m = Math.max(0, Math.round(parseDecimal(mins).value ?? 0)) || cooldownMinutes(settings);
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
                <Label htmlFor="cooldown-mins" className="text-xs">مدة التهدئة (دقائق)</Label>
                <NumberField
                  id="cooldown-mins"
                  inputMode="numeric"
                  className="w-32"
                  value={mins ?? ""}
                  onValueChange={setMins}
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

        {/* Today's losing run and his own cooldown length; it never rewrites the saved default. */}
        {cool && left === 0 && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3.5 text-xs text-destructive flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" />
              <span>{cool.message}</span>
            </div>
            <Button
              size="sm"
              variant="destructive"
              className="shrink-0"
              onClick={() =>
                saveCooldown({ cooldown_until: new Date(Date.now() + coolMin * 60000).toISOString() })
              }
            >
              تهدئة {coolMin} دقيقة
            </Button>
          </div>
        )}
      </div>

      {nudges.length > 0 && (
        <ul className="panel space-y-2 p-4 text-sm">
          {nudges.map((x) => (
            <li key={x.kind} className="flex items-start gap-2">
              <Info className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>{x.message}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Everything below is discipline.ts's report: the score and its reasons come from one place. */}
      {rep.score == null ? (
        <p className="panel p-5 text-center text-sm text-muted-foreground">ما فيه صفقات بآخر {WINDOW_DAYS} يوم. سجّل صفقتك وتطلع درجتك هنا.</p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat
              label="درجة الانضباط"
              value={`${rep.score}/100`}
              tone={rep.score >= 80 ? "success" : rep.score < 60 ? "destructive" : "warning"}
            />
            <Stat
              label="الالتزام بوقف الخسارة"
              value={pct(mt.stopLossSetRate)}
              tone={(mt.stopLossSetRate ?? 0) >= 90 ? "success" : "destructive"}
            />
            <Stat label="الالتزام بقائمة التحقق" value={pct(mt.planAdherenceRate)} />
            <Stat
              label="تداول انتقامي محتمل"
              value={mt.revengeCount}
              tone={mt.revengeCount > 0 ? "destructive" : undefined}
            />
            <Stat
              label="صفقات بمشاعر طمع"
              value={mt.greedCount}
              tone={mt.greedCount > 0 ? "warning" : undefined}
            />
          </div>

          <div className="panel p-6 space-y-4">
            <h3 className="font-bold text-base flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <span>ليش درجتك {rep.score}/100؟</span>
            </h3>
            <p className="text-xs text-muted-foreground">
              من {rep.sample} صفقة بآخر {WINDOW_DAYS} يوم. الدخول خلال {mt.revengeWindowMin} دقيقة بعد خسارة ينحسب انتقام.
            </p>
            {rep.concerns.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="size-4 shrink-0" />
                <span>ما فيه ولا إشارة سلبية. كمّل كذا.</span>
              </div>
            ) : (
              <ul className="space-y-2 text-sm">
                {rep.concerns.map((x) => (
                  <li key={x} className="flex items-start gap-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-destructive" />
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
            )}
            {rep.strengths.length > 0 && (
              <ul className="space-y-2 border-t border-border pt-3 text-sm">
                {rep.strengths.map((x) => (
                  <li key={x} className="flex items-start gap-2 text-success">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {rep.emotionVsResult.length > 1 && (
            <div className="panel space-y-2 p-6">
              <h3 className="font-bold text-base">مشاعرك ونتيجتها</h3>
              <ul className="divide-y divide-border text-sm">
                {rep.emotionVsResult.map((r) => (
                  <li key={r.emotion} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate">
                      {r.emotion}{" "}
                      <span className="text-xs text-muted-foreground">
                        ({r.count}{r.winRate != null ? ` · فوز ${Math.round(r.winRate)}%` : ""})
                      </span>
                    </span>
                    <span dir="ltr" className={`font-data shrink-0 ${r.pnl > 0 ? "text-success" : r.pnl < 0 ? "text-destructive" : ""}`}>
                      {r.closed ? fmtMoney(r.pnl, cur, { trim: true }) : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

