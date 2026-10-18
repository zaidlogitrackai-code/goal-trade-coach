import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { COACH_DRAFT_KEY } from "@/components/dashboard/quick-coach";
import { safeSession } from "@/lib/safe-storage";
import { money } from "@/components/dashboard/core-metrics";
import type { Trade } from "@/lib/queries";

/** Open trades with a one-tap "I closed it" that hands off to the coach. */
export function OpenTrades({ trades, currency }: { trades: Trade[]; currency: string }) {
  const nav = useNavigate();
  const open = trades.filter((x) => x.status === "open");
  if (!open.length) return null;
  function closeIt(t: Trade) {
    safeSession.set(COACH_DRAFT_KEY, JSON.stringify({ text: `سكّرت صفقة ${t.symbol}، بكم؟ اسألني عن سعر الخروج والربح أو الخسارة وسجّل الإغلاق`, image: null }));
    void nav({ to: "/coach" });
  }
  return (
    <section className="panel space-y-3 p-4 sm:p-5">
      <h2 className="text-sm font-semibold">صفقاتك المفتوحة ({open.length})</h2>
      <ul className="divide-y divide-border/50">
        {open.map((t) => (
          <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5">
            <div className="min-w-0 space-y-0.5">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <span dir="ltr" className="font-data">{t.symbol}</span>
                <span className={`text-xs font-medium ${t.direction === "long" ? "text-success" : "text-destructive"}`}>{t.direction === "long" ? "شراء" : "بيع"}</span>
              </p>
              <p className="truncate text-xs text-muted-foreground">
                دخول <span className="font-data">{t.entry_price ?? "—"}</span>
                {" · "}
                {t.stop_loss != null ? <>وقف <span className="font-data">{t.stop_loss}</span></> : <span className="inline-flex items-center gap-1 font-semibold text-destructive"><AlertTriangle className="size-3" />بدون وقف</span>}
                {" · "}مخاطرة {money(Number(t.risk_amount), currency)}
              </p>
            </div>
            <Button size="sm" variant="secondary" className="shrink-0" onClick={() => closeIt(t)}>سكّرتها</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
