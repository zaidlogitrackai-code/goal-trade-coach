import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { currentUserId, type Settings } from "@/lib/queries";
import { validateRiskSettings, SUPPORTED_CURRENCIES } from "@/lib/risk-validation";
import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";

const FIELDS = [
  { key: "starting_balance", label: "الرصيد الابتدائي", hint: "رصيد حسابك الحالي" },
  { key: "daily_target", label: "الهدف اليومي", hint: "الربح الذي يكفيك اليوم" },
  { key: "max_daily_profit", label: "الحد الأعلى للربح", hint: "عند الوصول له يتوقف التداول لحماية الربح" },
  { key: "max_daily_loss", label: "الحد الأقصى للخسارة", hint: "أقصى خسارة مسموحة اليوم" },
  { key: "max_trades_per_day", label: "أقصى عدد صفقات", hint: "عدد الصفقات المسموح يومياً", int: true },
  { key: "max_risk_per_trade", label: "أقصى مخاطرة لكل صفقة", hint: "المبلغ الأقصى المعرض للخسارة بصفقة" },
  { key: "max_daily_risk", label: "أقصى مخاطرة يومية", hint: "مجموع المخاطرة لكل صفقات اليوم" },
  { key: "max_consecutive_losses", label: "أقصى خسائر متتالية", hint: "بعدها يتوقف التداول", int: true },
  { key: "weekly_target", label: "الهدف الأسبوعي", hint: "إذا وصلته يقول لك النظام كفاية هالأسبوع" },
  { key: "weekly_max_loss", label: "حد الخسارة الأسبوعي", hint: "عنده يوقف التداول لنهاية الأسبوع" },
  { key: "monthly_target", label: "الهدف الشهري", hint: "ربح الشهر المطلوب" },
  { key: "monthly_max_loss", label: "حد الخسارة الشهري", hint: "عنده يوقف التداول لنهاية الشهر" },
] as const;

type Values = Record<(typeof FIELDS)[number]["key"], string> & {
  session_start: string;
  session_end: string;
  currency: string;
};

export function LimitsForm({
  initial,
  submitLabel,
  onDone,
}: {
  initial: Settings | null;
  submitLabel: string;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState<Values>(() => {
    const o = {} as Values;
    for (const f of FIELDS) o[f.key] = initial && initial[f.key] ? String(initial[f.key]) : "";
    o.session_start = initial?.session_start?.slice(0, 5) ?? "";
    o.session_end = initial?.session_end?.slice(0, 5) ?? "";
    o.currency = initial?.currency ?? "USD";
    return o;
  });

  // Real-time validation
  const validation = useMemo(() => {
    const numericValues: Record<string, number> = {};
    for (const f of FIELDS) numericValues[f.key] = Number(v[f.key] || 0);
    return validateRiskSettings({
      ...numericValues,
      session_start: v.session_start || null,
      session_end: v.session_end || null,
      currency: v.currency,
    });
  }, [v]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!validation.valid) {
      toast.error(validation.errors[0]?.message || "يرجى تصحيح الأخطاء في الإعدادات");
      return;
    }

    setBusy(true);
    try {
      const user_id = await currentUserId();
      const row: Record<string, unknown> = {
        user_id,
        onboarded: true,
        updated_at: new Date().toISOString(),
        currency: v.currency || "USD",
      };
      for (const f of FIELDS) row[f.key] = Number(v[f.key] || 0);
      row["session_start"] = v.session_start || null;
      row["session_end"] = v.session_end || null;
      const { error } = await supabase.from("trading_settings").upsert(row as never);
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("تم حفظ إعدادات المخاطر بنجاح");
      onDone?.();
    } catch {
      toast.error("تعذر حفظ الإعدادات");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      {/* Validation Feedback */}
      {validation.errors.length > 0 && (
        <div className="panel border-destructive/40 bg-destructive/5 p-4 text-xs text-destructive space-y-1">
          <p className="font-semibold flex items-center gap-1.5">
            <AlertCircle className="size-4" />
            <span>تعارض أو خطأ في إعدادات المخاطر:</span>
          </p>
          <ul className="list-disc list-inside space-y-0.5 pr-2">
            {validation.errors.map((err, i) => (
              <li key={i}>{err.message}</li>
            ))}
          </ul>
        </div>
      )}

      {validation.warnings.length > 0 && (
        <div className="panel border-warning/40 bg-warning/5 p-4 text-xs text-warning space-y-1">
          <p className="font-semibold flex items-center gap-1.5">
            <AlertTriangle className="size-4" />
            <span>تنبيهات للمراجعة:</span>
          </p>
          <ul className="list-disc list-inside space-y-0.5 pr-2">
            {validation.warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.key} className="panel space-y-2 p-4">
            <Label htmlFor={f.key}>{f.label}</Label>
            <Input
              id={f.key}
              type="number"
              min={0}
              step={"int" in f ? 1 : "any"}
              dir="ltr"
              className="font-data"
              value={v[f.key]}
              onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">{f.hint}</p>
          </div>
        ))}

        <div className="panel space-y-2 p-4">
          <Label>أوقات التداول المسموحة</Label>
          <div className="flex items-center gap-2" dir="ltr">
            <Input
              type="time"
              value={v.session_start}
              onChange={(e) => setV({ ...v, session_start: e.target.value })}
            />
            <span className="text-muted-foreground">→</span>
            <Input
              type="time"
              value={v.session_end}
              onChange={(e) => setV({ ...v, session_end: e.target.value })}
            />
          </div>
          <p className="text-xs text-muted-foreground">وقت بدء الجلسة — وقت انتهاء الجلسة</p>
        </div>

        <div className="panel space-y-2 p-4">
          <Label htmlFor="currency">العملة الحسابية</Label>
          <Input
            id="currency"
            dir="ltr"
            maxLength={4}
            value={v.currency}
            onChange={(e) => setV({ ...v, currency: e.target.value.toUpperCase() })}
          />
          <p className="text-xs text-muted-foreground">
            العملات الشائعة: {SUPPORTED_CURRENCIES.slice(0, 5).join(", ")}
          </p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">اترك أي حد فارغاً (أو صفر) إذا كنت لا ترغب بتفعيله حالياً.</p>

      <Button
        type="submit"
        size="lg"
        disabled={busy || !validation.valid}
        className="w-full sm:w-auto"
      >
        {busy ? "جارٍ الحفظ…" : submitLabel}
      </Button>
    </form>
  );
}
