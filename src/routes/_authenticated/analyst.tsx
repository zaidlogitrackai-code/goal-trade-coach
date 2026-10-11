import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { Md } from "@/components/md";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { analyzeChart } from "@/lib/ai.functions";
import { fmtDate } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/analyst")({
  head: () => ({ meta: [{ title: "المحلل الذكي — نظام هادي" }, { name: "description", content: "ارفع صورة الشارت واحصل على تحليل مبني على قواعدك واستراتيجياتك." }] }),
  component: AnalystPage,
});

const historyQuery = {
  queryKey: ["analyses"],
  queryFn: async () => {
    const { data, error } = await supabase.from("chart_analyses").select("*").order("created_at", { ascending: false }).limit(30);
    if (error) throw error;
    return data;
  },
};

function AnalystPage() {
  const qc = useQueryClient();
  const run = useServerFn(analyzeChart);
  const h = useQuery(historyQuery);
  const [image, setImage] = useState<string | null>(null);
  const [symbol, setSymbol] = useState("");
  const [timeframe, setTimeframe] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  function onFile(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast.error("ارفع صورة فقط"); return; }
    if (f.size > 5 * 1024 * 1024) { toast.error("الصورة أكبر من ٥ ميجا"); return; }
    const r = new FileReader();
    r.onload = () => setImage(String(r.result));
    r.readAsDataURL(f);
  }

  async function submit() {
    if (!image) { toast.error("ارفع صورة الشارت أولاً"); return; }
    setBusy(true); setResult(null);
    try {
      const row = await run({ data: { image, symbol: symbol.toUpperCase(), timeframe, question } });
      setResult(row.result);
      qc.invalidateQueries({ queryKey: ["analyses"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل التحليل");
    } finally { setBusy(false); }
  }

  async function del(id: string) {
    const { error } = await supabase.from("chart_analyses").delete().eq("id", id);
    if (error) { toast.error("ما قدرت أحذف"); return; }
    qc.invalidateQueries({ queryKey: ["analyses"] });
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="المحلل الذكي" subtitle="ارفع صورة الشارت، ويحللها لك حسب قواعدك واستراتيجياتك." />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="panel space-y-4 p-5">
          <label className="flex min-h-48 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted p-4 text-center text-sm text-muted-foreground">
            {image ? <img src={image} alt="الشارت" className="max-h-72 rounded-md" /> : <>اضغط لاختيار صورة الشارت<span className="text-xs">PNG / JPG — حتى ٥ ميجا</span></>}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>الأصل</Label><Input dir="ltr" placeholder="BTCUSD" value={symbol} onChange={(e) => setSymbol(e.target.value)} /></div>
            <div className="space-y-2"><Label>الفريم</Label><Input dir="ltr" placeholder="H1" value={timeframe} onChange={(e) => setTimeframe(e.target.value)} /></div>
          </div>
          <div className="space-y-2"><Label>سؤالك (اختياري)</Label><Textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="مثلاً: هل الدخول شراء الآن مناسب؟" /></div>
          <Button className="w-full" size="lg" disabled={busy} onClick={submit}>{busy ? "جارٍ التحليل… (قد يأخذ دقيقة)" : "حلّل الشارت"}</Button>
          <p className="text-xs text-muted-foreground">التحليل للمساعدة فقط، والقرار النهائي لك.</p>
        </div>
        <div className="panel min-h-48 p-5">
          <h2 className="mb-3 font-semibold">نتيجة التحليل</h2>
          {result ? <Md>{result}</Md> : <p className="text-sm text-muted-foreground">{busy ? "يحلل الشارت الآن…" : "النتيجة تظهر هنا بعد التحليل."}</p>}
        </div>
      </div>

      <h2 className="mb-3 mt-10 text-lg font-semibold">التحليلات السابقة</h2>
      {(h.data ?? []).length === 0 ? <EmptyState text="أول تحليل لك بيظهر هنا." /> : (
        <div className="space-y-3">
          {h.data!.map((a) => (
            <details key={a.id} className="panel p-4">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                <span><span className="font-data font-semibold" dir="ltr">{a.symbol || "—"}</span> <span className="text-xs text-muted-foreground">{a.timeframe} · {fmtDate(a.created_at)}</span></span>
                <Button size="sm" variant="ghost" onClick={(e) => { e.preventDefault(); del(a.id); }}>حذف</Button>
              </summary>
              {a.question && <p className="mt-3 text-sm text-muted-foreground">سؤالك: {a.question}</p>}
              <div className="mt-3"><Md>{a.result}</Md></div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
