import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDownToLine, ArrowUpFromLine, Pencil, Trash2, Wallet } from "lucide-react";
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
import { MOVE_LABEL, type CapitalMove } from "@/lib/capital";
import { deleteCapitalEntry, moveCapital, useCapital } from "@/lib/capital-store";
import { fmtDate, fmtMoney } from "@/lib/queries";

type Kind = CapitalMove["kind"];
const DIALOG: Record<Kind, { title: string; hint: string; label: string }> = {
  deposit: { title: "إيداع", hint: "مبلغ زدته على حساب التداول.", label: "المبلغ" },
  withdrawal: { title: "سحب", hint: "مبلغ سحبته من حساب التداول.", label: "المبلغ" },
  set_balance: {
    title: "تعديل الرصيد",
    hint: "اكتب رصيدك الحقيقي الآن كما يظهر بالمنصة، والفرق بيتسجل كتصحيح.",
    label: "رصيدك الحالي",
  },
};

/** Live capital: starting balance + closed trades + deposits − withdrawals. */
export function CapitalCard({ currency }: { currency: string }) {
  const cap = useCapital();
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  if (!cap) return null;
  const { summary: s, ledger } = cap;
  const m = (n: number) => fmtMoney(n, currency);
  const recent = [...ledger.entries].reverse().slice(0, 5);

  async function remove(id: string) {
    try {
      await deleteCapitalEntry(id);
      await qc.invalidateQueries({ queryKey: ["capital"] });
      toast.success("حذفت الحركة");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر الحذف");
    } finally {
      setConfirmId(null);
    }
  }

  return (
    <section className="panel space-y-4 p-5" aria-labelledby="capital-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="capital-title" className="flex items-center gap-2 text-lg font-semibold">
            <Wallet className="size-5 text-primary" aria-hidden="true" /> رأس المال
          </h2>
          <p className="mt-2 font-data text-3xl font-bold" dir="ltr">
            {m(s.balance)}
          </p>
          <p
            className={`mt-1 font-data text-xs ${s.growth >= 0 ? "text-success" : "text-destructive"}`}
            dir="ltr"
          >
            {s.growth >= 0 ? "+" : ""}
            {m(s.growth)} ({s.growthPct}%)
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setKind("deposit")}>
            <ArrowDownToLine className="ml-1 size-4" aria-hidden="true" /> إيداع
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setKind("withdrawal")}>
            <ArrowUpFromLine className="ml-1 size-4" aria-hidden="true" /> سحب
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setKind("set_balance")}>
            <Pencil className="ml-1 size-4" aria-hidden="true" /> تعديل الرصيد
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {(
          [
            ["البداية", s.starting],
            ["نتيجة الصفقات", s.tradePnl],
            ["الإيداعات", s.deposits],
            ["السحوبات", -s.withdrawals],
          ] as const
        ).map(([label, v]) => (
          <div key={label} className="rounded-lg bg-muted/30 p-2.5">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 font-data font-medium" dir="ltr">
              {m(v)}
            </dd>
          </div>
        ))}
      </dl>

      {recent.length > 0 ? (
        <ul className="divide-y divide-border text-sm">
          {recent.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <span className="font-medium">{MOVE_LABEL[e.kind]}</span>
                <span className="mx-1.5 text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground">{fmtDate(e.at)}</span>
                {e.note && <p className="truncate text-xs text-muted-foreground">{e.note}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span
                  dir="ltr"
                  className={`font-data ${e.kind === "withdrawal" || e.amount < 0 ? "text-destructive" : "text-success"}`}
                >
                  {e.kind === "withdrawal" ? "-" : e.amount > 0 ? "+" : ""}
                  {m(Math.abs(e.amount))}
                </span>
                {confirmId === e.id ? (
                  <Button size="sm" variant="destructive" onClick={() => void remove(e.id)}>
                    تأكيد الحذف
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="حذف الحركة"
                    onClick={() => setConfirmId(e.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          الأرباح والخسائر بتنحسب على الرصيد لحالها. إذا الرقم مش مطابق لحسابك، اضغط "تعديل الرصيد"
          أو قول للمدرب "رصيدي صار كذا".
        </p>
      )}

      {kind && (
        <MoveDialog
          kind={kind}
          currency={currency}
          balance={s.balance}
          onClose={() => setKind(null)}
        />
      )}
    </section>
  );
}

function MoveDialog({
  kind,
  currency,
  balance,
  onClose,
}: {
  kind: Kind;
  currency: string;
  balance: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const d = DIALOG[kind];

  async function save() {
    setBusy(true);
    try {
      const r = await moveCapital({ kind, amount: Number(amount), note });
      await qc.invalidateQueries({ queryKey: ["capital"] });
      toast.success(`تم. رصيدك صار ${fmtMoney(r.balance, currency)}`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر الحفظ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{d.title}</DialogTitle>
          <DialogDescription>
            {d.hint} الرصيد الحالي: <span dir="ltr">{fmtMoney(balance, currency)}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="cap-amount">{d.label}</Label>
            <Input
              id="cap-amount"
              dir="ltr"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cap-note">ملاحظة (اختياري)</Label>
            <Input
              id="cap-note"
              value={note}
              placeholder="مثل: سحب أرباح الشهر"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={busy || amount === ""} onClick={() => void save()}>
            {busy ? "جارٍ الحفظ…" : "حفظ"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
