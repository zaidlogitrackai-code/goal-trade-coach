import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, Loading, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/ui/number-field";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { AiTradeInput } from "@/components/ai-trade-input";
import { matchOpen, type AiTrade } from "@/lib/ai-trade";
import { useNavigate } from "@tanstack/react-router";
import { fmtDate, fmtMoney, settingsQuery, strategiesQuery, tradesQuery, type Trade } from "@/lib/queries";
import { parseDecimal } from "@/lib/num";
import { expectedPnlSign } from "@/lib/trade-idea";
import { fromWallInput, toWallInput } from "@/lib/trading-day";
import { enterMovesToNextField } from "@/lib/form-keys";
import { AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/trades")({
  head: () => ({ meta: [{ title: "سجل الصفقات — نظام هادي" }, { name: "description", content: "كل صفقاتك المسجلة." }] }),
  // ?trade=<id>: a bell alert about one trade (no stop, open too long) lands on that row.
  validateSearch: z.object({ trade: z.string().uuid().optional().catch(undefined) }),
  component: TradesPage,
});

type Filter = "all" | "open" | "win" | "loss";

function TradesPage() {
  const t = useQuery(tradesQuery);
  const s = useQuery(settingsQuery);
  const st = useQuery(strategiesQuery);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [closing, setClosing] = useState<Trade | null>(null);
  const [prefill, setPrefill] = useState<{ exit: string; pnl: string } | null>(null);
  const navigate = useNavigate();
  const { trade: focusId } = Route.useSearch();
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!focusId || !t.data || shown.current === focusId) return;
    shown.current = focusId;
    if (!t.data.some((x) => x.id === focusId)) { toast.error("الصفقة هذي ما عادت موجودة"); return; }
    // Clear any filter that would hide it, then bring it into view once it has rendered.
    setFilter("all"); setQ("");
    requestAnimationFrame(() => document.getElementById(`trade-${focusId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }, [focusId, t.data]);
  function onAi(list: AiTrade[]) {
    const c = list.find((x) => x.action === "close");
    if (!c) { toast.message("هذي صفقة جديدة، بنقلك لصفحة الصفقة الجديدة"); navigate({ to: "/new-trade" }); return; }
    const m = matchOpen(c, t.data ?? []);
    if (!m) { toast.error("ما لقيت صفقة مفتوحة مطابقة"); return; }
    setPrefill({ exit: c.exit_price != null ? String(c.exit_price) : "", pnl: c.pnl != null ? String(c.pnl) : "" });
    setClosing(m);
  }
  if (t.isLoading) return <Loading />;
  const cur = s.data?.currency ?? "USD";
  const names = new Map((st.data ?? []).map((x) => [x.id, x.name]));
  const all = t.data ?? [];
  const rows = all.filter((x) => {
    if (q && !x.symbol.includes(q.toUpperCase())) return false;
    if (filter === "open") return x.status === "open";
    if (filter === "win") return x.status === "closed" && (x.pnl ?? 0) > 0;
    if (filter === "loss") return x.status === "closed" && (x.pnl ?? 0) < 0;
    return true;
  });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="سجل الصفقات" subtitle={`${all.length} صفقة مسجلة`} action={<Button asChild><Link to="/new-trade">صفقة جديدة</Link></Button>} />
      {all.length === 0 ? (
        <EmptyState action={<Button asChild><Link to="/new-trade">سجّل أول صفقة</Link></Button>} />
      ) : (
        <>
          <div className="mb-4"><AiTradeInput onResult={onAi} placeholder="مثال: أقفلت صفقة الذهب على 2375 بربح 120" /></div>
          <div className="mb-4 flex flex-wrap gap-2">
            {([["all", "الكل"], ["open", "مفتوحة"], ["win", "رابحة"], ["loss", "خاسرة"]] as const).map(([k, l]) => (
              <Button key={k} size="sm" variant={filter === k ? "default" : "secondary"} onClick={() => setFilter(k)}>{l}</Button>
            ))}
            <Input className="max-w-48" dir="ltr" placeholder="بحث بالأصل" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {rows.length === 0 ? (
            <EmptyState title="لا توجد نتائج" text="غيّر الفلتر للبحث." />
          ) : (
            <div className="space-y-3">
              {rows.map((x) => (
                <div key={x.id} id={`trade-${x.id}`} className={`panel flex scroll-mt-24 flex-wrap items-center gap-4 p-4 ${x.id === focusId ? "ring-2 ring-primary/60" : ""}`}>
                  <div className="min-w-28">
                    <p className="font-data font-semibold" dir="ltr">{x.symbol}</p>
                    <p className="text-xs text-muted-foreground">{x.direction === "long" ? "شراء" : "بيع"} · {fmtDate(x.opened_at)}</p>
                    {x.status === "open" && x.stop_loss == null && (
                      <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive">
                        <AlertTriangle className="size-3" aria-hidden="true" /> بدون وقف
                      </p>
                    )}
                  </div>
                  <div className="flex-1 text-xs text-muted-foreground">
                    {x.strategy_id && names.get(x.strategy_id) && <span className="ml-3">الاستراتيجية: {names.get(x.strategy_id)}</span>}
                    {x.emotion && <span className="ml-3">الحالة: {x.emotion}</span>}
                    <span className={x.checklist_passed ? "text-success" : "text-warning"}>{x.checklist_passed ? "مطابقة للقائمة" : "غير مطابقة للقائمة"}</span>
                    {x.notes && <p className="mt-1 text-foreground/70">{x.notes}</p>}
                  </div>
                  <div className="font-data text-sm" dir="ltr">مخاطرة {fmtMoney(x.risk_amount, cur)}</div>
                  {x.status === "open" ? (
                    <Button size="sm" onClick={() => setClosing(x)}>إغلاق الصفقة</Button>
                  ) : (
                    <div className={`font-data min-w-24 text-left text-lg font-semibold ${(x.pnl ?? 0) >= 0 ? "text-success" : "text-destructive"}`} dir="ltr">{fmtMoney(x.pnl, cur)}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <CloseDialog key={closing?.id ?? "none"} trade={closing} prefill={prefill} onClose={() => { setClosing(null); setPrefill(null); }} />
    </div>
  );
}

function CloseDialog({ trade, prefill, onClose }: { trade: Trade | null; prefill: { exit: string; pnl: string } | null; onClose: () => void }) {
  const qc = useQueryClient();
  const tz = useQuery(settingsQuery).data?.timezone;
  // A win/loss toggle plus an absolute amount: the iPhone decimal pad has no minus key.
  const pre = parseDecimal(prefill?.pnl).value;
  const [side, setSide] = useState<"win" | "loss" | null>(pre == null || pre === 0 ? null : pre < 0 ? "loss" : "win");
  const [amount, setAmount] = useState(pre == null ? "" : String(Math.abs(pre)));
  const [exit, setExit] = useState(prefill?.exit ?? "");
  // null = "now" at the moment of saving; set only when he closed it earlier.
  const [closeAt, setCloseAt] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const exitNum = parseDecimal(exit).value;
  const implied = expectedPnlSign(trade?.direction, trade?.entry_price, exitNum);
  const disagree = (side === "win" && implied === -1) || (side === "loss" && implied === 1);
  async function save() {
    const amt = parseDecimal(amount), ex = parseDecimal(exit);
    if (!trade) return;
    if (amt.invalid || ex.invalid) { toast.error("في رقم مكتوب غلط، صحّحه"); return; }
    if (amt.value == null) { toast.error("أدخل النتيجة"); return; }
    const abs = Math.abs(amt.value);
    const s = side ?? (amt.value < 0 ? "loss" : null);
    if (abs > 0 && !s) { toast.error("اختر ربح أو خسارة"); return; }
    const closedAt = closeAt == null ? new Date() : fromWallInput(closeAt, tz);
    if (!closedAt) { toast.error("حدد وقت الإغلاق"); return; }
    // A minute of slack: the picker has no seconds.
    if (closedAt.getTime() > Date.now() + 60_000) { toast.error("وقت الإغلاق بالمستقبل، صحّحه"); return; }
    if (closedAt.getTime() < new Date(trade.opened_at).getTime() - 60_000) { toast.error("وقت الإغلاق قبل وقت فتح الصفقة"); return; }
    const { error } = await supabase.from("trades").update({
      status: "closed",
      pnl: s === "loss" ? -abs : abs,
      exit_price: ex.value,
      close_notes: notes || null,
      closed_at: closedAt.toISOString(),
    }).eq("id", trade.id);
    if (error) { toast.error("تعذر إغلاق الصفقة"); return; }
    await qc.invalidateQueries({ queryKey: ["trades"] });
    toast.success("تم إغلاق الصفقة");
    setSide(null); setAmount(""); setExit(""); setCloseAt(null); setNotes("");
    onClose();
  }
  return (
    <ResponsiveSheet
      open={!!trade}
      onOpenChange={(o) => !o && onClose()}
      title={<>إغلاق صفقة <span dir="ltr">{trade?.symbol}</span></>}
      onSubmit={() => void save()}
      onKeyDown={enterMovesToNextField}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label>النتيجة</Label>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="ربح أو خسارة">
          <Button type="button" size="lg" variant={side === "win" ? "default" : "secondary"} aria-pressed={side === "win"} onClick={() => setSide("win")}>ربح</Button>
          <Button type="button" size="lg" variant={side === "loss" ? "destructive" : "secondary"} aria-pressed={side === "loss"} onClick={() => setSide("loss")}>خسارة</Button>
        </div>
      </div>
      <div className="space-y-2"><Label htmlFor="close-amount">المبلغ</Label><NumberField id="close-amount" value={amount} onValueChange={setAmount} placeholder="120" /></div>
      <div className="space-y-2">
        <Label htmlFor="close-exit">سعر الخروج</Label>
        <NumberField id="close-exit" value={exit} onValueChange={setExit} aria-describedby={disagree ? "close-disagree" : undefined} />
        {disagree && (
          <p id="close-disagree" role="status" className="flex items-start gap-1.5 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {implied === 1
              ? `سعر الخروج يقول إنها ربح (${trade?.direction === "long" ? "شراء" : "بيع"} من ${trade?.entry_price})، وأنت مختار خسارة. متأكد؟`
              : `سعر الخروج يقول إنها خسارة (${trade?.direction === "long" ? "شراء" : "بيع"} من ${trade?.entry_price})، وأنت مختار ربح. متأكد؟`}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="close-at">وقت الإغلاق</Label>
        <Input
          id="close-at"
          type="datetime-local"
          dir="ltr"
          className="h-11 text-base md:text-base"
          value={closeAt ?? toWallInput(new Date(), tz)}
          min={trade ? toWallInput(trade.opened_at, tz) : undefined}
          max={toWallInput(new Date(), tz)}
          onChange={(e) => setCloseAt(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">الحين تلقائياً. لو سكّرتها قبل، غيّر الوقت.</p>
      </div>
      <div className="space-y-2"><Label htmlFor="close-notes">ماذا تعلمت؟</Label><Textarea id="close-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      <Button type="submit" size="lg" className="w-full">حفظ النتيجة</Button>
    </ResponsiveSheet>
  );
}
