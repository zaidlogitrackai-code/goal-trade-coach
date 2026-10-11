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
import { currentUserId, fmtMoney, settingsQuery, strategiesQuery, tradesQuery, violationsQuery } from "@/lib/queries";
import { computeDayMetrics, computeStatus, startOfToday, STATUS_META } from "@/lib/trading-status";

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
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [f, setF] = useState({ symbol: "", direction: "long", strategy_id: "", entry: "", sl: "", tp: "", size: "", risk: "", emotion: "", notes: "" });
  const [checks, setChecks] = useState<boolean[]>(CHECKLIST.map(() => false));
  const [busy, setBusy] = useState(false);

  if (s.isLoading || t.isLoading || !s.data) return <Loading />;
  const settings = s.data;
  const start = startOfToday().getTime();
  const m = computeDayMetrics(settings, t.data ?? [], (v.data ?? []).filter((x) => new Date(x.occurred_at).getTime() >= start).length);
  const status = computeStatus(settings, m);
  const blocked = ["stopped", "loss_limit"].includes(status);
  const risk = Number(f.risk || 0);
  const overTrade = settings.max_risk_per_trade > 0 && risk > settings.max_risk_per_trade;
  const overDay = m.riskRemaining != null && risk > m.riskRemaining;
  const allChecked = checks.every(Boolean);
  const strategies = (st.data ?? []).filter((x) => x.allowed);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.symbol.trim()) return toast.error("أدخل الأصل");
    setBusy(true);
    try {
      const user_id = await currentUserId();
      const num = (x: string) => (x === "" ? null : Number(x));
      const { error } = await supabase.from("trades").insert({
        user_id,
        symbol: f.symbol.trim().toUpperCase(),
        direction: f.direction,
        strategy_id: f.strategy_id || null,
        entry_price: num(f.entry),
        stop_loss: num(f.sl),
        take_profit: num(f.tp),
        position_size: num(f.size),
        risk_amount: risk,
        emotion: f.emotion || null,
        notes: f.notes || null,
        checklist_passed: allChecked,
      });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["trades"] });
      toast.success("تم تسجيل الصفقة");
      navigate({ to: "/trades" });
    } catch {
      toast.error("تعذر حفظ الصفقة");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="الصفقة الجديدة" subtitle={`الحالة: ${STATUS_META[status].label}`} />
      {blocked && (
        <div className="panel mb-6 border-destructive/50 p-4 text-sm text-destructive">
          {STATUS_META[status].hint} النظام ينصحك بعدم فتح صفقات جديدة اليوم.
        </div>
      )}
      <form onSubmit={submit} className="space-y-6">
        <section className="panel p-5">
          <h2 className="mb-4 font-semibold">قائمة التحقق قبل الدخول</h2>
          <div className="space-y-3">
            {CHECKLIST.map((c, i) => (
              <label key={c} className="flex cursor-pointer items-center gap-3 text-sm">
                <Checkbox checked={checks[i]} onCheckedChange={(val) => setChecks(checks.map((x, j) => (j === i ? !!val : x)))} />
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
                <Button key={k} type="button" variant={f.direction === k ? "default" : "secondary"} onClick={() => setF({ ...f, direction: k })}>{l}</Button>
              ))}
            </div>
          </div>
          <div className="space-y-2"><Label>سعر الدخول</Label><Input type="number" step="any" dir="ltr" value={f.entry} onChange={(e) => setF({ ...f, entry: e.target.value })} /></div>
          <div className="space-y-2"><Label>وقف الخسارة</Label><Input type="number" step="any" dir="ltr" value={f.sl} onChange={(e) => setF({ ...f, sl: e.target.value })} /></div>
          <div className="space-y-2"><Label>الهدف</Label><Input type="number" step="any" dir="ltr" value={f.tp} onChange={(e) => setF({ ...f, tp: e.target.value })} /></div>
          <div className="space-y-2"><Label>حجم الصفقة</Label><Input type="number" step="any" dir="ltr" value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })} /></div>
          <div className="space-y-2 sm:col-span-2">
            <Label>مبلغ المخاطرة ({settings.currency})</Label>
            <Input type="number" step="any" min={0} dir="ltr" className="font-data" value={f.risk} onChange={(e) => setF({ ...f, risk: e.target.value })} />
            <p className="text-xs text-muted-foreground">
              الحد لكل صفقة: {settings.max_risk_per_trade > 0 ? fmtMoney(settings.max_risk_per_trade, settings.currency) : "غير محدد"} · المتبقي اليوم: {m.riskRemaining != null ? fmtMoney(m.riskRemaining, settings.currency) : "غير محدد"}
            </p>
            {overTrade && <p className="text-xs text-destructive">المخاطرة أعلى من الحد المسموح لكل صفقة.</p>}
            {overDay && <p className="text-xs text-destructive">هذه الصفقة تتجاوز المخاطرة اليومية المتبقية.</p>}
          </div>
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

        <Button type="submit" size="lg" disabled={busy} variant={blocked || overTrade || overDay ? "destructive" : "default"}>
          {busy ? "جارٍ الحفظ…" : blocked || overTrade || overDay ? "تسجيل رغم التحذير" : "تسجيل الصفقة"}
        </Button>
      </form>
    </div>
  );
}
