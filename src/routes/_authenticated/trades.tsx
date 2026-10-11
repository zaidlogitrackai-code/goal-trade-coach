import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, Loading, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AiTradeInput } from "@/components/ai-trade-input";
import { matchOpen, type AiTrade } from "@/lib/ai-trade";
import { useNavigate } from "@tanstack/react-router";
import { fmtDate, fmtMoney, settingsQuery, strategiesQuery, tradesQuery, type Trade } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/trades")({
  head: () => ({ meta: [{ title: "سجل الصفقات — نظام هادي" }, { name: "description", content: "كل صفقاتك المسجلة." }] }),
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
                <div key={x.id} className="panel flex flex-wrap items-center gap-4 p-4">
                  <div className="min-w-28">
                    <p className="font-data font-semibold" dir="ltr">{x.symbol}</p>
                    <p className="text-xs text-muted-foreground">{x.direction === "long" ? "شراء" : "بيع"} · {fmtDate(x.opened_at)}</p>
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
  const [pnl, setPnl] = useState(prefill?.pnl ?? "");
  const [exit, setExit] = useState(prefill?.exit ?? "");
  const [notes, setNotes] = useState("");
  async function save() {
    if (!trade || pnl === "") { toast.error("أدخل النتيجة"); return; }
    const { error } = await supabase.from("trades").update({
      status: "closed",
      pnl: Number(pnl),
      exit_price: exit === "" ? null : Number(exit),
      close_notes: notes || null,
      closed_at: new Date().toISOString(),
    }).eq("id", trade.id);
    if (error) { toast.error("تعذر إغلاق الصفقة"); return; }
    await qc.invalidateQueries({ queryKey: ["trades"] });
    toast.success("تم إغلاق الصفقة");
    setPnl(""); setExit(""); setNotes("");
    onClose();
  }
  return (
    <Dialog open={!!trade} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>إغلاق صفقة {trade?.symbol}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2"><Label>الربح / الخسارة (سالب للخسارة)</Label><Input type="number" step="any" dir="ltr" value={pnl} onChange={(e) => setPnl(e.target.value)} /></div>
          <div className="space-y-2"><Label>سعر الخروج</Label><Input type="number" step="any" dir="ltr" value={exit} onChange={(e) => setExit(e.target.value)} /></div>
          <div className="space-y-2"><Label>ماذا تعلمت؟</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <Button className="w-full" onClick={save}>حفظ النتيجة</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
