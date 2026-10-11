import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Crosshair, MessagesSquare, Pencil, TrendingUp, AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  buildInsights,
  deriveSignals,
  isFocusEmpty,
  type FocusProfile,
  type SignalTrade,
} from "@/lib/focus";
import { focusQuery, saveFocus } from "@/lib/focus-store";
import { fmtMoney } from "@/lib/queries";

/** "Your focus now": what the trader told the coach, next to what their trades show. */
export function FocusCard({
  trades,
  strategies,
  currency,
}: {
  trades: SignalTrade[];
  strategies: { id: string; name: string }[];
  currency: string;
}) {
  const q = useQuery(focusQuery);
  const [editing, setEditing] = useState(false);
  if (q.isLoading) return null;
  const focus = q.data!;
  const insights = buildInsights(deriveSignals(trades, strategies, focus), focus, (n) =>
    fmtMoney(n, currency),
  );
  const empty = isFocusEmpty(focus);

  const rows: [string, string | null][] = [
    ["هدفك الحالي", focus.goal],
    ["نقطة ضعفك", focus.weakness],
    ["قاعدتك اليوم", focus.focus_rule],
  ];

  return (
    <section className="panel space-y-4 p-5" aria-labelledby="focus-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="focus-title" className="flex items-center gap-2 text-lg font-semibold">
          <Crosshair className="size-5 text-primary" /> تركيزك الآن
        </h2>
        <div className="flex items-center gap-2">
          {focus.markets.map((m) => (
            <span
              key={m}
              dir="ltr"
              className="rounded-full bg-primary/10 px-2.5 py-0.5 font-data text-xs text-primary"
            >
              {m}
            </span>
          ))}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEditing(true)}
            aria-label="تعديل ملف التركيز"
          >
            <Pencil className="size-3.5" />
          </Button>
        </div>
      </div>

      {empty ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border p-4 text-sm">
          <p className="text-muted-foreground">
            النظام لسا ما بيعرف سوقك وهدفك ونقطة ضعفك. احكي للمدرب عنهم، وكل الصفحات بتترتب حولهم.
          </p>
          <Button asChild size="sm">
            <Link to="/coach">
              <MessagesSquare className="ml-1.5 size-4" /> احكي للمدرب
            </Link>
          </Button>
        </div>
      ) : (
        <dl className="grid gap-3 sm:grid-cols-3">
          {rows.map(([label, value]) => (
            <div key={label} className="rounded-lg bg-muted/30 p-3">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className={`mt-1 text-sm ${value ? "font-medium" : "text-muted-foreground"}`}>
                {value ?? "—"}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {insights.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {insights.map((i) => (
            <li key={i.text} className="flex items-start gap-2">
              {i.tone === "warning" ? (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-label="تحذير" />
              ) : i.tone === "success" ? (
                <TrendingUp className="mt-0.5 size-4 shrink-0 text-success" aria-label="إيجابي" />
              ) : (
                <Info
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-label="معلومة"
                />
              )}
              <span>{i.text}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Mounted only while open so the form starts from the saved profile. */}
      {editing && <FocusDialog onClose={() => setEditing(false)} focus={focus} />}
    </section>
  );
}

function FocusDialog({ onClose, focus }: { onClose: () => void; focus: FocusProfile }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    markets: focus.markets.join("، "),
    goal: focus.goal ?? "",
    weakness: focus.weakness ?? "",
    focus_rule: focus.focus_rule ?? "",
    style: focus.style ?? "",
  });
  const fields = [
    ["markets", "أسواقك", "مثل: ذهب، NAS100"],
    ["style", "أسلوبك وجلستك", "مثل: سكالبينغ جلسة نيويورك"],
    ["goal", "هدفك الحالي", "مثل: شهر كامل بدون كسر حد الخسارة"],
    ["weakness", "نقطة ضعفك", "مثل: أكمل تداول بعد ما أوصل الهدف"],
    ["focus_rule", "القاعدة اللي بتركز عليها", "مثل: بعد خسارتين أوقف"],
  ] as const;

  async function save() {
    setBusy(true);
    try {
      await saveFocus(f);
      await qc.invalidateQueries({ queryKey: ["focus"] });
      toast.success("حدّثت ملف التركيز");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر الحفظ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>ملف التركيز</DialogTitle>
          <DialogDescription>
            المدرب بيحدّثه لما تحكيله عن نفسك، وبتقدر تعدّله هون.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {fields.map(([k, label, ph]) => (
            <div key={k} className="space-y-1">
              <Label htmlFor={`focus-${k}`}>{label}</Label>
              <Input
                id={`focus-${k}`}
                value={f[k]}
                placeholder={ph}
                onChange={(e) => setF({ ...f, [k]: e.target.value })}
              />
            </div>
          ))}
          {focus.notes.length > 0 && (
            <div className="rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">المدرب بيتذكر عنك:</p>
              <ul className="list-inside list-disc space-y-0.5">
                {focus.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={busy} onClick={save}>
            {busy ? "جارٍ الحفظ…" : "حفظ"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
