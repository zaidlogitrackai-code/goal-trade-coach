import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/ui/number-field";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { activeSessionQuery, settingsQuery, todayPlanQuery, tradesQuery } from "@/lib/queries";
import { useCapital } from "@/lib/capital-store";
import { numOrNull } from "@/lib/num";
import { dayKey, dayStart, addDays } from "@/lib/trading-day";
import { activeTempRules } from "@/lib/trade-review";
import { isPlanRevision } from "@/lib/daily-plan";
import type { Json } from "@/integrations/supabase/types";

const FORBIDDEN = ["لا ذهب وقت الأخبار", "لا دخول بدون ستوب", "لا صفقة انتقام", "لا تداول بعد الهدف"];
const MOODS = ["مرتاح", "متحمس", "متوتر", "تعبان", "زعلان"];

const FIELDS = [
  { key: "target", label: "هدف اليوم" },
  { key: "max_trades", label: "أقصى عدد صفقات" },
  { key: "risk_per_trade", label: "المخاطرة بالصفقة" },
  { key: "max_loss", label: "أقصى خسارة اليوم" },
] as const;
type Key = (typeof FIELDS)[number]["key"];

const str = (v: unknown) => (v == null || v === "" ? "" : String(v));

/** The recent plans whose accepted rules may still be in force today. */
const recentPlansQuery = (tz: string | null | undefined) => ({
  queryKey: ["daily_plan", "recent", tz ?? ""] as const,
  queryFn: async () => {
    const { data, error } = await supabase.from("daily_plans").select("day,rules_today").gte("day", addDays(dayKey(new Date(), tz), -31));
    if (error) throw error;
    return data ?? [];
  },
});

/** Step 2 (خطة اليوم): today's numbers, the rules in force, or a rest day. Saving starts the session. */
export function PlanSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const s = useQuery(settingsQuery);
  const tz = s.data?.timezone;
  const plan = useQuery({ ...todayPlanQuery(tz), enabled: !!s.data });
  if (!s.data || plan.isLoading) return null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-2xl px-4 pb-0">
        <SheetHeader className="text-start">
          <SheetTitle>خطة اليوم</SheetTitle>
          <SheetDescription>اكتب أرقامك قبل أول صفقة. الخطة تقدر تشدّد حدودك، ما ترخّيها.</SheetDescription>
        </SheetHeader>
        {/* Keyed by the row so a reopen after a save starts from what is stored. */}
        <PlanForm key={plan.data?.set_at ?? "new"} tz={tz} onDone={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}

function PlanForm({ tz, onDone }: { tz: string | null | undefined; onDone: () => void }) {
  const qc = useQueryClient();
  const s = useQuery(settingsQuery).data!;
  const cur = useQuery(todayPlanQuery(tz)).data ?? null;
  const trades = useQuery(tradesQuery).data ?? [];
  const recent = useQuery(recentPlansQuery(tz)).data ?? [];
  const session = useQuery(activeSessionQuery).data;
  const capital = useCapital();

  const [vals, setVals] = useState<Record<Key, string>>(() => ({
    target: str(cur?.target ?? (Number(s.daily_target) || "")),
    max_trades: str(cur?.max_trades ?? (Number(s.max_trades_per_day) || "")),
    risk_per_trade: str(cur?.risk_per_trade ?? (Number(s.max_risk_per_trade) || "")),
    max_loss: str(cur?.max_loss ?? (Number(s.max_daily_loss) || "")),
  }));
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [mood, setMood] = useState<string | null>(null);
  const [acked, setAcked] = useState(!!cur?.rules_ack_at);
  const [busy, setBusy] = useState(false);

  const rules = activeTempRules(recent, trades, new Date(), tz);
  const startOfDay = dayStart(new Date(), tz).getTime();
  const tradesToday = trades.filter((t) => new Date(t.opened_at).getTime() >= startOfDay).length;
  const maxLoss = numOrNull(vals.max_loss);
  const looser = maxLoss != null && Number(s.max_daily_loss) > 0 && maxLoss > Number(s.max_daily_loss);

  async function save(restDay: boolean) {
    if (!restDay && rules.length && !acked) { toast.error("شوف قواعدك المؤقتة واضغط «شفتها» أول"); return; }
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("سجّل دخولك أول");
      const day = dayKey(new Date(), tz);
      const nums = Object.fromEntries(FIELDS.map((f) => [f.key, numOrNull(vals[f.key])])) as Record<Key, number | null>;
      const extra = forbidden ? [`ممنوع اليوم: ${forbidden}`] : [];
      const prevRules = Array.isArray(cur?.rules_today) ? (cur!.rules_today as Json[]) : [];
      const row = {
        ...(restDay ? {} : nums),
        no_trading: restDay,
        rules_today: [...prevRules, ...extra] as Json,
        rules_ack_at: rules.length && acked ? cur?.rules_ack_at ?? new Date().toISOString() : cur?.rules_ack_at ?? null,
        // The day's % limits read from this snapshot, so it is taken once and kept.
        start_balance: cur?.start_balance ?? capital?.summary.balance ?? (Number(s.starting_balance) || null),
      };
      const { error } = cur
        ? await supabase.from("daily_plans").update({ ...row, revised_count: cur.revised_count + (isPlanRevision(cur, nums, tradesToday) ? 1 : 0) }).eq("id", cur.id)
        : await supabase.from("daily_plans").insert({ user_id: user.id, day, ...row });
      if (error) throw error;
      if (!restDay && !session) {
        const text = [
          nums.target != null && `الهدف ${nums.target}`, nums.max_trades != null && `أقصى ${nums.max_trades} صفقات`,
          nums.risk_per_trade != null && `مخاطرة ${nums.risk_per_trade} بالصفقة`, nums.max_loss != null && `أقصى خسارة ${nums.max_loss}`,
          forbidden && `ممنوع: ${forbidden}`,
        ].filter(Boolean).join(" · ");
        const { error: e2 } = await supabase.from("trading_sessions").insert({ user_id: user.id, plan: text || "خطة اليوم", mood });
        if (e2) throw e2;
      }
      await Promise.all([qc.invalidateQueries({ queryKey: ["daily_plan"] }), qc.invalidateQueries({ queryKey: ["sessions"] })]);
      toast.success(restDay ? "يوم راحة. استمتع فيه" : "ثبّتنا الخطة. التزم فيها");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ما انحفظت الخطة");
    } finally { setBusy(false); }
  }

  function nextField(i: number) {
    const next = document.getElementById(`plan-${FIELDS[i + 1]?.key}`);
    if (next) next.focus(); else (document.activeElement as HTMLElement | null)?.blur();
  }

  return (
    <form className="space-y-5 pt-2" onSubmit={(e) => { e.preventDefault(); void save(false); }}>
      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map((f, i) => (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={`plan-${f.key}`}>{f.label}</Label>
            <NumberField
              id={`plan-${f.key}`}
              inputMode={f.key === "max_trades" ? "numeric" : "decimal"}
              value={vals[f.key]}
              onValueChange={(v) => setVals((p) => ({ ...p, [f.key]: v }))}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); nextField(i); } }}
              error={f.key === "max_loss" && looser ? `أرخى من حدك (${s.max_daily_loss})، بنمشي على حدك` : null}
            />
          </div>
        ))}
      </div>

      <Chips label="شي واحد ممنوع اليوم" options={FORBIDDEN} value={forbidden} onChange={setForbidden} />
      <Chips label="كيف نفسيتك؟" options={MOODS} value={mood} onChange={setMood} />
      <Input className="h-11 text-base" placeholder="أو اكتب الممنوع بكلامك" onBlur={(e) => { const v = e.target.value.trim(); if (v) setForbidden(v); }} />

      {rules.length > 0 && (
        <div className="space-y-2 rounded-xl bg-muted p-3">
          <p className="text-sm font-semibold">قواعدك المؤقتة الشغالة</p>
          <ul className="list-disc space-y-1 ps-5 text-sm">
            {rules.map((r) => <li key={r.text}>{r.text}{r.left != null ? ` (باقي ${r.left} صفقات)` : ""}</li>)}
          </ul>
          <Button type="button" variant={acked ? "secondary" : "default"} className="h-11 w-full gap-2" onClick={() => setAcked(true)} disabled={acked}>
            {acked && <Check className="size-4" />} {acked ? "شفتها" : "شفتها، ملتزم فيها"}
          </Button>
        </div>
      )}

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t bg-background/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
        <Button type="submit" className="h-11 flex-1" disabled={busy}>{busy ? "جارٍ الحفظ…" : "ثبّت الخطة"}</Button>
        <Button type="button" variant="secondary" className="h-11" disabled={busy} onClick={() => void save(true)}>يوم راحة</Button>
      </div>
    </form>
  );
}

function Chips({ label, options, value, onChange }: { label: string; options: string[]; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(value === o ? null : o)}
            className={`min-h-11 rounded-full border px-4 text-sm ${value === o ? "border-foreground bg-foreground text-background" : "bg-muted/40"}`}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
