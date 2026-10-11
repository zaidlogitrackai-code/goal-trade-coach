import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Loading } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AiTradeInput } from "@/components/ai-trade-input";
import { toForm, type AiTrade } from "@/lib/ai-trade";
import { currentUserId, fmtMoney, settingsQuery, strategiesQuery, tradesQuery, violationsQuery } from "@/lib/queries";
import { computeDayMetrics, startOfToday } from "@/lib/trading-status";
import { evaluateTradeGate } from "@/lib/trade-gate";
import { inMarkets, splitMarkets } from "@/lib/focus";
import { FOREX_ONLY_MSG, forexSymbol } from "@/lib/forex";
import { focusQuery } from "@/lib/focus-store";
import { AlertCircle, AlertTriangle, CheckCircle2, ShieldAlert, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/new-trade")({
  head: () => ({
    meta: [
      { title: "صفقة جديدة — نظام هادي" },
      { name: "description", content: "سجّل صفقة جديدة بانضباط مع بوابة المخاطر وفحص قائمة التحقق." },
    ],
  }),
  component: NewTrade,
});

const CHECKLIST_ITEMS = [
  { id: "strategy", label: "الإعداد مطابق تماماً للاستراتيجية", desc: "وجود كل شروط الدخول والتأكيد المكتوبة في استراتيجيتك." },
  { id: "sl", label: "حددت وقف الخسارة مسبقاً قبل الدخول", desc: "نقطة وقف الخسارة واضحة وتلغي فكرة الصفقة إذا وصلها السعر." },
  { id: "risk", label: "المخاطرة ضمن الحدود المالية المقررة", desc: "حجم العقد محسوب بحيث لا يتجاوز حد المخاطرة للصفقة واليوم." },
  { id: "not_revenge", label: "لست أتداول لتعويض خسارة سابقة", desc: "الدخول مبني على فرصة سوقية وليس بدافع الانتقام واسترداد المال." },
  { id: "calm", label: "أنا هادئ ومركّز ومستعد ذهنياً", desc: "خالٍ من التوتر أو الغضب أو الاستعجال الناتج عن FOMO." },
];

const EMOTIONS = ["هادئ", "واثق", "متوتر", "متحمس", "خائف", "غاضب", "طمع"];
const SENSITIVE_EMOTIONS = ["طمع", "خائف", "متوتر", "غاضب"];
/** Minimum answer length for "what is pushing you to enter?" */
const MOTIVE_MIN = 10;
/** Minimum length for an override justification. */
const JUSTIFY_MIN = 15;

function NewTrade() {
  const s = useQuery(settingsQuery);
  const t = useQuery(tradesQuery);
  const v = useQuery(violationsQuery);
  const st = useQuery(strategiesQuery);
  const focus = useQuery(focusQuery);
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("trading_sessions").select("*").order("started_at", { ascending: false }).limit(5);
      if (error) throw error;
      return data;
    },
  });

  const qc = useQueryClient();
  const navigate = useNavigate();

  const [f, setF] = useState({
    symbol: "",
    direction: "long",
    strategy_id: "",
    entry: "",
    sl: "",
    tp: "",
    size: "",
    risk: "",
    emotion: "",
    notes: "",
  });

  // Emotional reflection fields
  const [reflectionReason, setReflectionReason] = useState("");
  const [isCompensating, setIsCompensating] = useState<boolean | null>(null);

  // Exception Override Modal
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overrideNote, setOverrideNote] = useState("");

  const [checks, setChecks] = useState<boolean[]>(CHECKLIST_ITEMS.map(() => false));
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<AiTrade[]>([]);

  const settings = s.data;
  if (s.isLoading || t.isLoading || !settings) return <Loading />;
  const start = startOfToday().getTime();
  const violationsToday = (v.data ?? []).filter((x) => new Date(x.occurred_at).getTime() >= start).length;
  const metrics = computeDayMetrics(settings, t.data ?? [], violationsToday);

  const activeSession = (sessions.data ?? []).find((x) => !x.ended_at) ?? null;
  const strategies = (st.data ?? []).filter((x) => x.allowed);
  const allowedStrategyIds = strategies.map((x) => x.id);

  // Keep the trade on the trader's own markets (focus profile) and the strategy's markets.
  const focusMarkets = focus.data?.markets ?? [];
  const chosenStrategy = strategies.find((x) => x.id === f.strategy_id);
  const strategyMarkets = splitMarkets(chosenStrategy?.markets);
  const notForex = f.symbol.trim() !== "" && !forexSymbol(f.symbol);
  const marketWarnings = notForex ? [] : [
    inMarkets(f.symbol, focusMarkets) === false
      ? `هذا الأصل برّا سوقك (${focusMarkets.join("، ")}). متأكد إنه مش تشتت؟`
      : null,
    chosenStrategy && inMarkets(f.symbol, strategyMarkets) === false
      ? `استراتيجية "${chosenStrategy.name}" مكتوبة لـ ${strategyMarkets.join("، ")}، مش لهذا الأصل.`
      : null,
  ].filter((x): x is string => !!x);

  const num = (x: string) => (x === "" ? null : Number(x));
  const entryNum = num(f.entry);
  const slNum = num(f.sl);
  const tpNum = num(f.tp);
  const sizeNum = num(f.size);
  const riskNum = num(f.risk) ?? (entryNum && slNum && sizeNum ? Math.abs(entryNum - slNum) * sizeNum : null);

  const allChecked = checks.every(Boolean);

  // Evaluate Trade Gate
  // Plain call, not useMemo: hooks can't run after the loading early-return above.
  const gateResult = evaluateTradeGate({
    settings,
    metrics,
    input: {
      symbol: f.symbol,
      direction: f.direction,
      entry_price: entryNum,
      stop_loss: slNum,
      take_profit: tpNum,
      position_size: sizeNum,
      risk_amount: riskNum,
      strategy_id: f.strategy_id || null,
      emotion: f.emotion || null,
      checklist_passed: allChecked,
    },
    activeSession,
    allowedStrategyIds,
    openTrades: (t.data ?? []).filter((x) => x.status === "open").map((x) => ({
      status: x.status,
      pnl: x.pnl,
      risk_amount: x.risk_amount,
      opened_at: x.opened_at,
      closed_at: x.closed_at,
    })),
    currentBalance: settings.starting_balance,
  });

  const sensitive = !!f.emotion && SENSITIVE_EMOTIONS.includes(f.emotion);
  const emotionCheckDone = !sensitive || (reflectionReason.trim().length >= MOTIVE_MIN && isCompensating !== null);
  const revenge = sensitive && isCompensating === true;
  // Everything that makes this trade a documented exception.
  const overrideReasons = [
    ...gateResult.reasons,
    ...(!slNum && !gateResult.reasons.some((r) => r.includes("وقف الخسارة")) ? ["لم يتم تحديد وقف الخسارة قبل الدخول"] : []),
    ...(revenge ? ["صفقة لتعويض خسارة سابقة (صفقة انتقامية)"] : []),
  ];

  // Calculations for display
  const potentialLoss = riskNum ?? (entryNum && slNum && sizeNum ? Math.abs(entryNum - slNum) * sizeNum : null);
  const potentialProfit = entryNum && tpNum && sizeNum ? Math.abs(tpNum - entryNum) * sizeNum : null;

  function load(list: AiTrade[]) {
    const opens = list.filter((x) => x.action === "open");
    if (opens.length === 0) {
      toast.message("هذا إغلاق صفقة — سجّله من صفحة سجل الصفقات");
      return;
    }
    const target = opens[0]!;
    setF(toForm(target, st.data ?? []));
    setQueue(opens.slice(1));
    toast.success("تم استخراج بيانات الصفقة للمراجعة. تأكد منها قبل الحفظ.");
  }

  async function executeSave(isOverride = false, overrideReasonText = "") {
    if (!f.symbol.trim()) {
      toast.error("يرجى إدخال رمز الأصل");
      return;
    }
    if (!forexSymbol(f.symbol)) {
      toast.error(FOREX_ONLY_MSG);
      return;
    }

    setBusy(true);
    try {
      const user_id = await currentUserId();
      const nowIso = new Date().toISOString();

      let notesCombined = f.notes.trim();
      if (isOverride && overrideReasonText) {
        notesCombined += `\n[مبرر الاستثناء]: ${overrideReasonText}`;
      }
      if (f.emotion && SENSITIVE_EMOTIONS.includes(f.emotion)) {
        if (reflectionReason) notesCombined += `\n[دافع الدخول]: ${reflectionReason}`;
        if (isCompensating !== null) notesCombined += `\n[هل هو تعويض]: ${isCompensating ? "نعم" : "لا"}`;
      }

      // 1. Insert trade
      const { data: newTrade, error: tradeErr } = await supabase
        .from("trades")
        .insert({
          user_id,
          symbol: forexSymbol(f.symbol)!,
          direction: f.direction,
          strategy_id: f.strategy_id || null,
          entry_price: entryNum,
          stop_loss: slNum,
          take_profit: tpNum,
          position_size: sizeNum,
          risk_amount: riskNum ?? 0,
          emotion: f.emotion || null,
          notes: notesCombined || null,
          checklist_passed: allChecked && !isOverride,
          opened_at: nowIso,
        })
        .select()
        .single();

      if (tradeErr) throw tradeErr;

      // 2. If this was an override with rule violations or no stop loss, log a rule_violation record!
      if (isOverride || overrideReasons.length > 0) {
        const { error: vErr } = await supabase.from("rule_violations").insert({
          user_id,
          trade_id: newTrade?.id ?? null,
          occurred_at: nowIso,
          note: `استثناء مصرح: ${overrideReasons.join(" · ")}${overrideReasonText ? ` | المبرر: ${overrideReasonText}` : ""}`,
        });
        if (vErr) toast.error(`سُجّلت الصفقة لكن تعذر تسجيل المخالفة: ${vErr.message}`);
      }

      await qc.invalidateQueries({ queryKey: ["trades"] });
      await qc.invalidateQueries({ queryKey: ["violations"] });
      toast.success("تم تسجيل الصفقة بنجاح");

      if (queue.length > 0) {
        setF(toForm(queue[0]!, st.data ?? []));
        setQueue(queue.slice(1));
        setChecks(CHECKLIST_ITEMS.map(() => false));
        setReflectionReason("");
        setIsCompensating(null);
        setOverrideNote("");
        toast.message("هذه الصفقة التالية المستخرجة، راجعها");
      } else {
        navigate({ to: "/trades" });
      }
    } catch (e) {
      const msg = (e as { message?: string } | null)?.message;
      toast.error(msg ? `تعذر حفظ الصفقة: ${msg}` : "تعذر حفظ الصفقة");
    } finally {
      setBusy(false);
      setOverrideModalOpen(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.symbol.trim()) {
      toast.error("يرجى إدخال الأصل");
      return;
    }
    if (!forexSymbol(f.symbol)) {
      toast.error(FOREX_ONLY_MSG);
      return;
    }

    // Hard blocked condition (cooldown, daily loss limit, paused)
    if (!gateResult.allowed && !gateResult.canOverride) {
      toast.error("التداول متوقف إجبارياً بحسب قواعد الحماية. لا يمكن فتح صفقات الآن.");
      return;
    }

    if (!emotionCheckDone) {
      toast.error("أجب عن سؤالَي فحص المشاعر قبل التسجيل.");
      return;
    }

    // Gate violations, no stop loss, or a revenge trade need a written justification.
    if (overrideReasons.length > 0) {
      setOverrideModalOpen(true);
      return;
    }

    executeSave(false);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        title="الصفقة الجديدة"
        subtitle="راجع الشروط والمخاطرة قبل الضغط على تنفيذ."
      />

      {/* Gate Alert Banner */}
      {!gateResult.allowed && (
        <div
          className={`panel p-5 border-2 space-y-2 ${
            gateResult.canOverride
              ? "border-warning/50 bg-warning/5 text-warning"
              : "border-destructive/50 bg-destructive/5 text-destructive"
          }`}
        >
          <div className="flex items-center gap-2 font-bold text-base">
            {gateResult.canOverride ? (
              <AlertTriangle className="size-5 shrink-0" />
            ) : (
              <ShieldAlert className="size-5 shrink-0" />
            )}
            <span>{gateResult.canOverride ? "تنبيه: الصفقة تخالف بعض القيود" : "التداول موقوف اليوم"}</span>
          </div>
          <ul className="list-disc list-inside space-y-1 text-xs sm:text-sm pr-1">
            {gateResult.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
          <p className="text-xs pt-1 border-t border-border/40 font-medium">
            الإجراء الموصى به: {gateResult.nextAction}
          </p>
        </div>
      )}

      {/* AI Assistant Extraction for Review */}
      <div className="space-y-3">
        <AiTradeInput onResult={load} />
        {queue.length > 0 && (
          <div className="panel flex flex-wrap items-center gap-2 p-4 text-sm">
            <span className="text-muted-foreground">صفقات تالية جاهزة للمراجعة:</span>
            {queue.map((q, i) => (
              <Button
                key={i}
                size="sm"
                variant="secondary"
                onClick={() => {
                  setF(toForm(q, st.data ?? []));
                  setQueue(queue.filter((_, j) => j !== i));
                }}
              >
                <span dir="ltr">{q.symbol ?? "?"}</span> {q.direction === "short" ? "بيع" : "شراء"}
              </Button>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Checklist */}
        <section className="panel p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-base">قائمة التحقق قبل الدخول</h2>
            <span className={`text-xs font-semibold ${allChecked ? "text-success" : "text-warning"}`}>
              {allChecked ? "مكتملة بالكامل" : "غير مكتملة"}
            </span>
          </div>

          <div className="space-y-3">
            {CHECKLIST_ITEMS.map((item, i) => (
              <label
                key={item.id}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/50 p-3 transition-colors hover:bg-muted/30"
              >
                <Checkbox
                  checked={!!checks[i]}
                  onCheckedChange={(val) =>
                    setChecks(checks.map((x, j) => (j === i ? !!val : x)))
                  }
                  className="mt-0.5"
                />
                <div className="space-y-0.5">
                  <p className="text-sm font-medium leading-none text-foreground">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </section>

        {/* Trade Parameters */}
        <section className="panel grid gap-4 p-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="symbol">الأصل المالي</Label>
            <Input
              id="symbol"
              dir="ltr"
              placeholder="EURUSD أو XAUUSD"
              value={f.symbol}
              onChange={(e) => setF({ ...f, symbol: e.target.value })}
              aria-invalid={notForex || undefined}
              aria-describedby={notForex ? "symbol-forex" : marketWarnings.length ? "symbol-warn" : undefined}
            />
            {focusMarkets.length > 0 && (
              <div className="flex flex-wrap gap-1.5" aria-label="أسواقك">
                {focusMarkets.map((m) => (
                  <button
                    key={m}
                    type="button"
                    dir="ltr"
                    onClick={() => setF({ ...f, symbol: m })}
                    className={`rounded-full border px-2.5 py-0.5 font-data text-xs transition-colors ${f.symbol.toUpperCase() === m ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
            {notForex && (
              <p id="symbol-forex" role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                {FOREX_ONLY_MSG} اكتب زوج مثل EURUSD أو XAUUSD.
              </p>
            )}
            {marketWarnings.length > 0 && (
              <ul id="symbol-warn" className="space-y-1 text-xs text-warning">
                {marketWarnings.map((w) => (
                  <li key={w} className="flex items-start gap-1.5">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    {w}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <Label>الاتجاه</Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                ["long", "شراء (Long)"],
                ["short", "بيع (Short)"],
              ].map(([k, l]) => (
                <Button
                  key={k}
                  type="button"
                  variant={f.direction === k ? "default" : "secondary"}
                  onClick={() => setF({ ...f, direction: k! })}
                >
                  {l}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="entry">سعر الدخول</Label>
            <Input
              id="entry"
              type="number"
              step="any"
              dir="ltr"
              value={f.entry}
              onChange={(e) => setF({ ...f, entry: e.target.value })}
              placeholder="1.0850"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sl">وقف الخسارة (إلزامي)</Label>
            <Input
              id="sl"
              type="number"
              step="any"
              dir="ltr"
              className={!slNum ? "border-destructive/60" : ""}
              value={f.sl}
              onChange={(e) => setF({ ...f, sl: e.target.value })}
              placeholder="1.0800"
            />
            {!slNum && (
              <p className="text-xs text-destructive">تحديد وقف الخسارة إلزامي لحماية رأس مالك.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="tp">الهدف (أخذ الربح)</Label>
            <Input
              id="tp"
              type="number"
              step="any"
              dir="ltr"
              value={f.tp}
              onChange={(e) => setF({ ...f, tp: e.target.value })}
              placeholder="1.0950"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="size">حجم الصفقة (العقد / الكمية)</Label>
            <Input
              id="size"
              type="number"
              step="any"
              dir="ltr"
              value={f.size}
              onChange={(e) => setF({ ...f, size: e.target.value })}
              placeholder="1.0"
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="risk">مبلغ المخاطرة بالعملة ({settings.currency})</Label>
            <Input
              id="risk"
              type="number"
              step="any"
              min={0}
              dir="ltr"
              className="font-data"
              value={f.risk}
              onChange={(e) => setF({ ...f, risk: e.target.value })}
              placeholder={potentialLoss ? String(Math.round(potentialLoss * 100) / 100) : "50"}
            />
            <p className="text-xs text-muted-foreground">
              الحد الأقصى لكل صفقة:{" "}
              {settings.max_risk_per_trade > 0
                ? fmtMoney(settings.max_risk_per_trade, settings.currency)
                : "غير محدد"}{" "}
              · المتبقي اليوم:{" "}
              {metrics.riskRemaining != null
                ? fmtMoney(metrics.riskRemaining, settings.currency)
                : "غير محدد"}
            </p>
          </div>
        </section>

        {/* Real-time Calculated Metrics Panel */}
        <section className="panel p-6 bg-muted/20 border-primary/20 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <span>الحسابات الفورية ومؤشرات الصفقة</span>
          </h3>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">الخسارة المحتملة</span>
              <p dir="ltr" className="font-data text-lg font-bold text-destructive">
                {potentialLoss != null ? fmtMoney(potentialLoss, settings.currency) : "—"}
              </p>
            </div>

            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">الربح المحتمل</span>
              <p dir="ltr" className="font-data text-lg font-bold text-success">
                {potentialProfit != null ? fmtMoney(potentialProfit, settings.currency) : "—"}
              </p>
            </div>

            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">نسبة العائد للمخاطرة (R:R)</span>
              <p dir="ltr" className="font-data text-lg font-bold text-foreground">
                {gateResult.metrics.rewardToRiskRatio != null
                  ? `1 : ${gateResult.metrics.rewardToRiskRatio}`
                  : "غير متوفر"}
              </p>
            </div>

            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">نسبة المخاطرة من الرصيد</span>
              <p dir="ltr" className="font-data text-lg font-bold text-foreground">
                {gateResult.metrics.riskPercentOfBalance}%
              </p>
            </div>
          </div>
        </section>

        {/* Strategy & Psychological Reflection */}
        <section className="panel space-y-5 p-6">
          <div className="space-y-2">
            <Label>الاستراتيجية المتبعة</Label>
            {strategies.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                لا توجد استراتيجيات بعد.{" "}
                <Link to="/strategies" className="text-primary underline">
                  أضف استراتيجية موثقة
                </Link>
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {strategies.map((x) => (
                  <Button
                    key={x.id}
                    type="button"
                    size="sm"
                    variant={f.strategy_id === x.id ? "default" : "secondary"}
                    onClick={() =>
                      setF({ ...f, strategy_id: f.strategy_id === x.id ? "" : x.id })
                    }
                  >
                    {x.name}
                  </Button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>الحالة النفسية والمشاعر</Label>
            <div className="flex flex-wrap gap-2">
              {EMOTIONS.map((emo) => (
                <Button
                  key={emo}
                  type="button"
                  size="sm"
                  variant={f.emotion === emo ? "default" : "secondary"}
                  onClick={() => setF({ ...f, emotion: f.emotion === emo ? "" : emo })}
                >
                  {emo}
                </Button>
              ))}
            </div>
          </div>

          {/* Mandatory Reflection Question if sensitive emotion chosen */}
          {f.emotion && SENSITIVE_EMOTIONS.includes(f.emotion) && (
            <div className="rounded-lg border border-warning/40 bg-warning/5 p-4 space-y-3 text-xs">
              <p className="font-semibold text-warning flex items-center gap-1.5">
                <AlertCircle className="size-4" />
                <span>فحص المشاعر (إلزامي للتهدئة):</span>
              </p>
              <div className="space-y-1.5">
                <Label className="text-xs">ما الذي يدفعك للدخول في هذه اللحظة تحديداً؟</Label>
                <Input
                  placeholder="اكتب سبب دخولك بموضوعية..."
                  value={reflectionReason}
                  onChange={(e) => setReflectionReason(e.target.value)}
                />
                {reflectionReason.trim().length < MOTIVE_MIN && (
                  <p className="text-muted-foreground">اكتب {MOTIVE_MIN} أحرف على الأقل.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">هل هذه الصفقة محاولة لتعويض خسارة سابقة؟</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={isCompensating === true ? "destructive" : "secondary"}
                    onClick={() => setIsCompensating(true)}
                  >
                    نعم
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={isCompensating === false ? "default" : "secondary"}
                    onClick={() => setIsCompensating(false)}
                  >
                    لا، إعداد مستقل
                  </Button>
                </div>
                {revenge && (
                  <p className="text-destructive">
                    صفقة التعويض أكثر صفقة تكسر الخطة. إذا كملت، بتحتاج تكتب مبرر وبتنسجل كمخالفة.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="notes">ملاحظات الصفقة</Label>
            <Textarea
              id="notes"
              value={f.notes}
              onChange={(e) => setF({ ...f, notes: e.target.value })}
              placeholder="لماذا اخترت هذا الإعداد؟ ما هي علامات الإلغاء؟"
            />
          </div>
        </section>

        {/* Submit Button */}
        <Button
          type="submit"
          size="lg"
          disabled={busy || (!gateResult.allowed && !gateResult.canOverride)}
          variant={
            !gateResult.allowed
              ? "destructive"
              : overrideReasons.length > 0
              ? "outline"
              : "default"
          }
          className="w-full sm:w-auto text-base"
        >
          {busy
            ? "جارٍ الحفظ…"
            : !gateResult.allowed && !gateResult.canOverride
            ? "التداول موقوف اليوم"
            : !emotionCheckDone
            ? "أجب عن فحص المشاعر أولاً"
            : overrideReasons.length > 0
            ? "تسجيل مع مبرر استثناء"
            : "تسجيل الصفقة بانضباط"}
        </Button>
      </form>

      {/* Override Reason Modal */}
      <Dialog open={overrideModalOpen} onOpenChange={setOverrideModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <ShieldAlert className="size-5" />
              <span>تسجيل صفقة مخالفة للقواعد (استثناء)</span>
            </DialogTitle>
            <DialogDescription>
              النظام لا يسمح بتجاوز قواعد التداول بصمت. لتسجيل هذه الصفقة، يجب توثيق مبرر الاستثناء وسيتم قيده كمخالفة في تقرير الانضباط.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-muted p-3 text-xs space-y-1">
              <span className="font-semibold block">المخالفات المرصودة:</span>
              <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                {overrideReasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>

            <div className="space-y-2">
              <Label htmlFor="overrideReason">سبب كسر القاعدة / الاستثناء (إلزامي)</Label>
              <Textarea
                id="overrideReason"
                placeholder="اكتب سبب رغبتك بتنفيذ الصفقة رغم التحذير..."
                value={overrideNote}
                onChange={(e) => setOverrideNote(e.target.value)}
              />
              {overrideNote.trim().length < JUSTIFY_MIN && (
                <p className="text-xs text-muted-foreground">اكتب {JUSTIFY_MIN} حرفًا على الأقل.</p>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOverrideModalOpen(false)}>
              إلغاء والالتزام بالقاعدة
            </Button>
            <Button
              variant="destructive"
              disabled={busy || overrideNote.trim().length < JUSTIFY_MIN}
              onClick={() => executeSave(true, overrideNote.trim())}
            >
              تأكيد الاستثناء والتسجيل
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default NewTrade;
