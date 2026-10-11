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
import { AiTradeInput } from "@/components/ai-trade-input";
import { toForm, type AiTrade } from "@/lib/ai-trade";
import { activeSessionQuery, currentUserId, fmtMoney, settingsQuery, strategiesQuery, tradesQuery, violationsQuery } from "@/lib/queries";
import { computeStatus, startOfToday, STATUS_META } from "@/lib/trading-status";
import { evaluateTradeGate, OVERRIDE_MIN_CHARS, overrideNote } from "@/lib/trade-gate";
import { pct } from "@/lib/risk-limits";

export const Route = createFileRoute("/_authenticated/new-trade")({
  head: () => ({ meta: [{ title: "صفقة جديدة — نظام هادي" }, { name: "description", content: "سجّل صفقة جديدة بعد قائمة التحقق." }] }),
  component: NewTrade,
});

const CHECKLIST = [
  "الإعداد مطابق لاستراتيجيتي",
  "حددت وقف الخسارة قبل الدخول",
  "المخاطرة ضمن الحد المسموح",
  "لست أتداول لتعويض خسارة",
  "أنا هادئ ومركّز",
];
const EMOTIONS = ["هادئ", "واثق", "متوتر", "متحمس", "خائف", "غاضب", "طمع"];

function NewTrade() {
  const s = useQuery(settingsQuery);
  const t = useQuery(tradesQuery);
  const v = useQuery(violationsQuery);
  const st = useQuery(strategiesQuery);
  const sess = useQuery(activeSessionQuery);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [f, setF] = useState({ symbol: "", direction: "long", strategy_id: "", entry: "", sl: "", tp: "", size: "", risk: "", emotion: "", notes: "" });
  const [checks, setChecks] = useState<boolean[]>(CHECKLIST.map(() => false));
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<AiTrade[]>([]);
  const [justification, setJustification] = useState("");
  // Client-generated id: a retried insert after a network drop hits the same
  // primary key instead of creating a duplicate trade.
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());

  if (s.isLoading || t.isLoading || v.isLoading || sess.isLoading || !s.data) return <Loading />;
  const settings = s.data;
  const start = startOfToday().getTime();
  const num = (x: string) => (x.trim() === "" || !Number.isFinite(Number(x)) ? null : Number(x));
  const gate = evaluateTradeGate({
    settings,
    trades: t.data ?? [],
    violationsToday: (v.data ?? []).filter((x) => new Date(x.occurred_at).getTime() >= start).length,
    hasActiveSession: !!sess.data,
    draft: { direction: f.direction, entry: num(f.entry), stop: num(f.sl), target: num(f.tp), size: num(f.size), riskInput: num(f.risk), strategyId: f.strategy_id || null },
  });
  const m = gate.metrics;
  const calc = gate.calc;
  const status = computeStatus(settings, m);
  const hardReasons = gate.reasons.filter((r) => r.hard);
  const softReasons = gate.reasons.filter((r) => !r.hard);
  const justificationOk = justification.trim().length >= OVERRIDE_MIN_CHARS;
  const canSubmit = !busy && (gate.allowed || (gate.canOverride && justificationOk));
  const cur = settings.currency;
  const na = "غير متاح";
  const allChecked = checks.every(Boolean);
  const strategies = (st.data ?? []).filter((x) => x.allowed);
  function load(list: AiTrade[]) {
    const opens = list.filter((x) => x.action === "open");
    if (opens.length === 0) { toast.message("هذا إغلاق صفقة — سوّه من سجل الصفقات"); return; }
    setF(toForm(opens[0]!, st.data ?? []));
    setQueue(opens.slice(1));
    toast.success("عبّيت البيانات، راجعها وكمّل قائمة التحقق");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!f.symbol.trim()) { toast.error("أدخل الأصل"); return; }
    if (!gate.allowed && !(gate.canOverride && justificationOk)) {
      toast.error(gate.canOverride ? "اكتب سبب الاستثناء أولًا" : "البوابة تمنع هذه الصفقة الآن");
      return;
    }
    const isOverride = !gate.allowed;
    setBusy(true);
    try {
      const user_id = await currentUserId();
      const { error } = await supabase.from("trades").insert({
        id: draftId,
        user_id,
        symbol: f.symbol.trim().toUpperCase(),
        direction: f.direction,
        strategy_id: f.strategy_id || null,
        entry_price: num(f.entry),
        stop_loss: num(f.sl),
        take_profit: num(f.tp),
        position_size: num(f.size),
        risk_amount: calc.risk ?? 0,
        emotion: f.emotion || null,
        notes: f.notes || null,
        checklist_passed: allChecked && !isOverride,
      });
      // 23505 = duplicate key: the same draft was already saved by an earlier attempt.
      if (error && error.code !== "23505") throw error;
      if (isOverride && !error) {
        const { error: vErr } = await supabase.from("rule_violations").insert({ user_id, trade_id: draftId, note: overrideNote(softReasons, justification) });
        if (vErr) toast.error("سُجلت الصفقة لكن تعذر تسجيل الاستثناء. سجّله يدويًا من صفحة القواعد.");
      }
      await qc.invalidateQueries({ queryKey: ["trades"] });
      await qc.invalidateQueries({ queryKey: ["violations"] });
      toast.success(isOverride ? "سُجلت الصفقة كاستثناء مخالف" : "تم تسجيل الصفقة");
      setDraftId(crypto.randomUUID());
      setJustification("");
      if (queue.length > 0) { setF(toForm(queue[0]!, st.data ?? [])); setQueue(queue.slice(1)); setChecks(CHECKLIST.map(() => false)); toast.message("هذي الصفقة التالية، راجعها"); } else navigate({ to: "/trades" });
    } catch {
      toast.error("تعذر حفظ الصفقة");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="الصفقة الجديدة" subtitle={`الحالة: ${STATUS_META[status].label}`} />
      <div className="mb-6 space-y-3">
        <AiTradeInput onResult={load} />
        {queue.length > 0 && (
          <div className="panel flex flex-wrap items-center gap-2 p-4 text-sm">
            <span className="text-muted-foreground">صفقات ثانية فهمتها:</span>
            {queue.map((q, i) => (
              <Button key={i} size="sm" variant="secondary" onClick={() => { setF(toForm(q, st.data ?? [])); setQueue(queue.filter((_, j) => j !== i)); }}>
                <span dir="ltr">{q.symbol ?? "?"}</span> {q.direction === "short" ? "بيع" : "شراء"}
              </Button>
            ))}
          </div>
        )}
      </div>
      <form onSubmit={submit} className="space-y-6">
        <section className="panel p-5">
          <h2 className="mb-4 font-semibold">قائمة التحقق قبل الدخول</h2>
          <div className="space-y-3">
            {CHECKLIST.map((c, i) => (
              <label key={c} className="flex cursor-pointer items-center gap-3 text-sm">
                <Checkbox checked={!!checks[i]} onCheckedChange={(val) => setChecks(checks.map((x, j) => (j === i ? !!val : x)))} />
                {c}
              </label>
            ))}
          </div>
          {!allChecked && <p className="mt-3 text-xs text-warning">لم تكتمل قائمة التحقق — ستُسجّل الصفقة كغير مطابقة.</p>}
        </section>

        <section className="panel grid gap-4 p-5 sm:grid-cols-2">
          <div className="space-y-2"><Label>الأصل</Label><Input dir="ltr" placeholder="EURUSD" value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value })} /></div>
          <div className="space-y-2">
            <Label>الاتجاه</Label>
            <div className="grid grid-cols-2 gap-2">
              {[["long", "شراء"], ["short", "بيع"]].map(([k, l]) => (
                <Button key={k} type="button" variant={f.direction === k ? "default" : "secondary"} onClick={() => setF({ ...f, direction: k! })}>{l}</Button>
              ))}
            </div>
          </div>
          <div className="space-y-2"><Label>سعر الدخول</Label><Input type="number" step="any" dir="ltr" value={f.entry} onChange={(e) => setF({ ...f, entry: e.target.value })} /></div>
          <div className="space-y-2"><Label>وقف الخسارة</Label><Input type="number" step="any" dir="ltr" value={f.sl} onChange={(e) => setF({ ...f, sl: e.target.value })} /></div>
          <div className="space-y-2"><Label>الهدف</Label><Input type="number" step="any" dir="ltr" value={f.tp} onChange={(e) => setF({ ...f, tp: e.target.value })} /></div>
          <div className="space-y-2"><Label>حجم الصفقة (وحدات)</Label><Input type="number" step="any" dir="ltr" value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })} /><p className="text-xs text-muted-foreground">عدد الوحدات أو الأسهم. في الفوركس: 1 لوت = 100,000 وحدة.</p></div>
          <div className="space-y-2 sm:col-span-2">
            <Label>مبلغ المخاطرة ({cur})</Label>
            <Input type="number" step="any" min={0} dir="ltr" className="font-data" value={f.risk} onChange={(e) => setF({ ...f, risk: e.target.value })} />
            <p className="text-xs text-muted-foreground">يُحسب تلقائيًا من الدخول والوقف والحجم. اكتبه فقط إذا لم تتوفر هذه الأرقام.</p>
            {calc.notes.map((n) => <p key={n} className="text-xs text-warning">{n}</p>)}
          </div>
        </section>

        <section className="panel p-5" aria-labelledby="risk-calc-title">
          <h2 id="risk-calc-title" className="mb-4 font-semibold">حساب المخاطرة</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <CalcItem label="المخاطرة لهذه الصفقة" value={calc.risk != null ? fmtMoney(calc.risk, cur) : na} />
            <CalcItem label="النسبة من الرصيد" value={calc.riskOfBalance != null ? pct(calc.riskOfBalance) : na} />
            <CalcItem label="الربح المحتمل" value={calc.potentialProfit != null ? fmtMoney(calc.potentialProfit, cur) : na} />
            <CalcItem label="العائد إلى المخاطرة" value={calc.rr != null ? `1 : ${calc.rr}` : na} />
            <CalcItem label="إجمالي المخاطرة المفتوحة" value={fmtMoney((t.data ?? []).filter((x) => x.status === "open").reduce((acc, x) => acc + (x.risk_amount ?? 0), 0), cur)} />
            <CalcItem label="مخاطرة اليوم المستخدمة" value={fmtMoney(m.riskUsed, cur)} />
            <CalcItem label="المخاطرة اليومية المتبقية" value={m.riskRemaining != null ? fmtMoney(m.riskRemaining, cur) : "غير مفعّل"} />
            <CalcItem label="الصفقات المتبقية" value={m.tradesRemaining != null ? String(m.tradesRemaining) : "غير مفعّل"} />
            <CalcItem label="الخسارة المتبقية قبل الإيقاف" value={m.lossRemaining != null ? fmtMoney(m.lossRemaining, cur) : "غير مفعّل"} />
            <CalcItem label="الربح المتبقي قبل حد التوقف" value={settings.max_daily_profit > 0 ? fmtMoney(Math.max(0, settings.max_daily_profit - m.todayPnl), cur) : "غير مفعّل"} />
          </dl>
        </section>

        <section className="panel space-y-4 p-5">
          <div className="space-y-2">
            <Label>الاستراتيجية</Label>
            {strategies.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد استراتيجيات بعد. <Link to="/strategies" className="text-primary">أضف استراتيجية</Link></p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {strategies.map((x) => (
                  <Button key={x.id} type="button" size="sm" variant={f.strategy_id === x.id ? "default" : "secondary"} onClick={() => setF({ ...f, strategy_id: f.strategy_id === x.id ? "" : x.id })}>{x.name}</Button>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label>حالتك النفسية</Label>
            <div className="flex flex-wrap gap-2">
              {EMOTIONS.map((x) => (
                <Button key={x} type="button" size="sm" variant={f.emotion === x ? "default" : "secondary"} onClick={() => setF({ ...f, emotion: f.emotion === x ? "" : x })}>{x}</Button>
              ))}
            </div>
          </div>
          <div className="space-y-2"><Label>ملاحظات</Label><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="ليش دخلت هذه الصفقة؟" /></div>
        </section>

        <section className={`panel space-y-3 p-5 ${gate.allowed ? "border-success/40" : hardReasons.length ? "border-destructive/50" : "border-warning/50"}`} aria-live="polite">
          <h2 className="font-semibold">بوابة التداول</h2>
          {gate.allowed ? (
            <p className="text-sm text-success">الصفقة ضمن كل الحدود. ({STATUS_META[status].label})</p>
          ) : (
            <>
              {hardReasons.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-destructive">لا يمكن تسجيل الصفقة الآن:</p>
                  <ul className="mt-1 list-disc space-y-1 ps-5 text-sm text-destructive">{hardReasons.map((r) => <li key={r.code + r.message}>{r.message}</li>)}</ul>
                </div>
              )}
              {softReasons.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-warning">{hardReasons.length ? "ملاحظات أخرى:" : "الصفقة مخالفة لخطتك:"}</p>
                  <ul className="mt-1 list-disc space-y-1 ps-5 text-sm text-warning">{softReasons.map((r) => <li key={r.code}>{r.message}</li>)}</ul>
                </div>
              )}
              {gate.nextAction && <p className="text-sm">الخطوة التالية: <span className="font-medium">{gate.nextAction}</span></p>}
              <div className="flex flex-wrap gap-2">
                {gate.reasons.some((r) => r.code === "no_session") && <Button asChild size="sm" variant="secondary"><Link to="/session">ابدأ جلسة التداول</Link></Button>}
                {gate.reasons.some((r) => r.code === "consecutive_losses" || r.code === "cooldown") && <Button asChild size="sm" variant="secondary"><Link to="/discipline">فترة التهدئة</Link></Button>}
                {gate.reasons.some((r) => r.code === "paused") && <Button asChild size="sm" variant="secondary"><Link to="/risk">إدارة المخاطر</Link></Button>}
              </div>
              {gate.canOverride && (
                <div className="space-y-2">
                  <Label htmlFor="justification">سبب الاستثناء (إلزامي)</Label>
                  <Textarea id="justification" value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="لماذا تدخل رغم مخالفة خطتك؟ ستُسجل الصفقة كمخالفة وتدخل في تحليل الانضباط." />
                  {!justificationOk && <p className="text-xs text-muted-foreground">اكتب {OVERRIDE_MIN_CHARS} حرفًا على الأقل.</p>}
                </div>
              )}
            </>
          )}
        </section>

        <Button type="submit" size="lg" disabled={!canSubmit} variant={gate.allowed ? "default" : "destructive"}>
          {busy ? "جارٍ الحفظ…" : gate.allowed ? "تسجيل الصفقة" : gate.canOverride ? "تسجيل كاستثناء مخالف" : "التسجيل ممنوع الآن"}
        </Button>
      </form>
    </div>
  );
}

function CalcItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-data mt-1 font-semibold" dir="ltr" style={{ textAlign: "right" }}>{value}</dd>
    </div>
  );
}
