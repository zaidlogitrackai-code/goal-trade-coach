import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { currentUserId, type Settings } from "@/lib/queries";
import { hasBlockingIssues, SUPPORTED_CURRENCIES, validateRiskLimits, type RiskIssue, type RiskSettingsRow } from "@/lib/risk-limits";

const FIELDS = [
  { key: "starting_balance", label: "الرصيد الابتدائي", hint: "رصيد حسابك الحالي" },
  { key: "daily_target", label: "الهدف اليومي (تنبيه)", hint: "عند بلوغه ينبهك النظام أنك حققت هدفك، ولا يوقف التداول وحده" },
  { key: "max_daily_profit", label: "حد إيقاف الربح اليومي", hint: "عند بلوغه يتوقف التداول لحماية الربح. يجب أن يكون مساويًا للهدف أو أعلى منه" },
  { key: "max_daily_loss", label: "حد الخسارة اليومية", hint: "عند بلوغه يتوقف التداول بقية اليوم" },
  { key: "max_trades_per_day", label: "أقصى عدد صفقات", hint: "عدد الصفقات المسموح يومياً", int: true },
  { key: "max_risk_per_trade", label: "أقصى مخاطرة لكل صفقة", hint: "أقصى مبلغ تخسره إذا ضُرب وقف الخسارة. تجاوزه يحتاج سببًا مكتوبًا" },
  { key: "max_daily_risk", label: "أقصى مخاطرة يومية", hint: "مجموع مخاطرة كل صفقات اليوم. لا تُسجّل صفقة تتجاوزه" },
  { key: "max_consecutive_losses", label: "أقصى خسائر متتالية", hint: "عند بلوغها اليوم يتوقف التداول بقية اليوم", int: true },
  { key: "weekly_target", label: "الهدف الأسبوعي", hint: "إذا وصلته يقول لك النظام كفاية هالأسبوع" },
  { key: "weekly_max_loss", label: "حد الخسارة الأسبوعي", hint: "عنده يوقف التداول لنهاية الأسبوع" },
  { key: "monthly_target", label: "الهدف الشهري", hint: "ربح الشهر المطلوب" },
  { key: "monthly_max_loss", label: "حد الخسارة الشهري", hint: "عنده يوقف التداول لنهاية الشهر" },
] as const;

type Values = Record<(typeof FIELDS)[number]["key"], string> & { session_start: string; session_end: string; currency: string };

export function LimitsForm({ initial, submitLabel, onDone }: { initial: Settings | null; submitLabel: string; onDone?: () => void }) {
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

  const row: RiskSettingsRow = {
    ...(Object.fromEntries(FIELDS.map((f) => [f.key, v[f.key] === "" ? 0 : Number(v[f.key])])) as Record<(typeof FIELDS)[number]["key"], number>),
    session_start: v.session_start || null,
    session_end: v.session_end || null,
    currency: v.currency,
  };
  const issues = validateRiskLimits(row);
  const blocking = hasBlockingIssues(issues);
  const issuesFor = (k: string) => issues.filter((i) => i.field === k);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (blocking) { toast.error("صحّح الحدود المتعارضة قبل الحفظ"); return; }
    setBusy(true);
    try {
      const user_id = await currentUserId();
      const payload = { ...row, user_id, onboarded: true, updated_at: new Date().toISOString(), currency: v.currency };
      const { error } = await supabase.from("trading_settings").upsert(payload as never);
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("تم حفظ الإعدادات");
      onDone?.();
    } catch {
      toast.error("تعذر حفظ الإعدادات");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.key} className="panel space-y-2 p-4">
            <Label htmlFor={f.key}>{f.label}</Label>
            <Input id={f.key} type="number" min={0} step={"int" in f ? 1 : "any"} dir="ltr" className="font-data" value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
            <p className="text-xs text-muted-foreground">{f.hint}</p>
            <IssueList issues={issuesFor(f.key)} />
          </div>
        ))}
        <div className="panel space-y-2 p-4">
          <Label>أوقات التداول</Label>
          <div className="flex items-center gap-2" dir="ltr">
            <Input type="time" value={v.session_start} onChange={(e) => setV({ ...v, session_start: e.target.value })} />
            <span className="text-muted-foreground">→</span>
            <Input type="time" value={v.session_end} onChange={(e) => setV({ ...v, session_end: e.target.value })} />
          </div>
          <p className="text-xs text-muted-foreground">من — إلى</p>
          <IssueList issues={[...issuesFor("session_start"), ...issuesFor("session_end")]} />
        </div>
        <div className="panel space-y-2 p-4">
          <Label htmlFor="currency">العملة</Label>
          <select
            id="currency"
            dir="ltr"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={v.currency}
            onChange={(e) => setV({ ...v, currency: e.target.value })}
          >
            {!(SUPPORTED_CURRENCIES as readonly string[]).includes(v.currency) && <option value={v.currency}>{v.currency || "—"}</option>}
            {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <IssueList issues={issuesFor("currency")} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">اترك أي حد فارغاً (صفر) إذا لا تريد تفعيله.</p>
      {blocking && (
        <p role="alert" className="text-sm text-destructive">توجد حدود متعارضة (موضحة بالأحمر). صحّحها ليتم الحفظ.</p>
      )}
      <Button type="submit" size="lg" disabled={busy || blocking}>{busy ? "جارٍ الحفظ…" : submitLabel}</Button>
    </form>
  );
}

function IssueList({ issues }: { issues: RiskIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-1">
      {issues.map((i) => (
        <li key={i.message} className={`text-xs ${i.severity === "error" ? "text-destructive" : "text-warning"}`}>
          {i.severity === "error" ? "خطأ: " : "تنبيه: "}{i.message}
        </li>
      ))}
    </ul>
  );
}
