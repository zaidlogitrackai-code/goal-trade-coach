import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, Loading, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { currentUserId, fmtDate, fmtMoney, settingsQuery, tradesQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/session")({
  head: () => ({ meta: [{ title: "جلسة التداول — نظام هادي" }, { name: "description", content: "ابدأ جلستك بخطة وأنهها بمراجعة." }] }),
  component: SessionPage,
});

const MOODS = ["هادئ", "واثق", "متوتر", "متعب", "متحمس"];

function SessionPage() {
  const qc = useQueryClient();
  const t = useQuery(tradesQuery);
  const s = useQuery(settingsQuery);
  const [plan, setPlan] = useState("");
  const [mood, setMood] = useState("هادئ");
  const [review, setReview] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  const ss = useQuery({
    queryKey: ["sessions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("trading_sessions").select("*").order("started_at", { ascending: false }).limit(30);
      if (error) throw error;
      return data;
    },
  });
  if (ss.isLoading) return <Loading />;
  const cur = s.data?.currency ?? "USD";
  const active = ss.data?.find((x) => !x.ended_at);
  const pnlBetween = (a: string, b: string | null) => (t.data ?? []).filter((x) => x.status === "closed" && x.closed_at && x.closed_at >= a && (!b || x.closed_at <= b));

  async function start() {
    const user_id = await currentUserId();
    const { error } = await supabase.from("trading_sessions").insert({ user_id, plan, mood });
    if (error) { toast.error("ما قدرت أبدأ الجلسة"); return; }
    setPlan(""); qc.invalidateQueries({ queryKey: ["sessions"] });
  }
  async function end() {
    if (!active) return;
    const { error } = await supabase.from("trading_sessions").update({ ended_at: new Date().toISOString(), review }).eq("id", active.id);
    if (error) { toast.error("ما قدرت أنهي الجلسة"); return; }
    setReview(""); toast.success("انتهت الجلسة"); qc.invalidateQueries({ queryKey: ["sessions"] });
  }
  async function del(id: string) {
    await supabase.from("trading_sessions").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["sessions"] });
  }
  const dur = (ms: number) => { const m = Math.floor(ms / 60000); return `${Math.floor(m / 60)}س ${m % 60}د`; };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="جلسة التداول" subtitle="خطة قبل، ومراجعة بعد." />
      {active ? (
        <div className="panel space-y-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-sm text-muted-foreground">جلسة جارية منذ {fmtDate(active.started_at)} · {active.mood}</p>
              <p className="font-data mt-1 text-3xl font-bold" dir="ltr">{new Date(now - +new Date(active.started_at)).toISOString().slice(11, 19)}</p></div>
            <div className="text-left"><p className="text-xs text-muted-foreground">ربح الجلسة</p><p className="font-data text-xl" dir="ltr">{fmtMoney(pnlBetween(active.started_at, null).reduce((a, x) => a + (Number(x.pnl) || 0), 0), cur)}</p></div>
          </div>
          {active.plan && <p className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm">خطتك: {active.plan}</p>}
          <div className="space-y-2"><Label>مراجعة الجلسة</Label><Textarea value={review} onChange={(e) => setReview(e.target.value)} placeholder="وش سويت صح؟ وش غلطت؟ هل التزمت بالخطة؟" /></div>
          <Button onClick={end}>إنهاء الجلسة</Button>
        </div>
      ) : (
        <div className="panel space-y-4 p-6">
          <div className="space-y-2"><Label>خطة الجلسة</Label><Textarea value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="الأصول اللي بتتابعها، الإعدادات اللي تنتظرها، وأقصى عدد صفقات." /></div>
          <div className="space-y-2"><Label>حالتك النفسية</Label><div className="flex flex-wrap gap-2">{MOODS.map((m) => <Button key={m} type="button" size="sm" variant={mood === m ? "default" : "secondary"} onClick={() => setMood(m)}>{m}</Button>)}</div></div>
          <Button onClick={start}>ابدأ الجلسة</Button>
        </div>
      )}
      <h2 className="text-lg font-semibold">الجلسات السابقة</h2>
      {(ss.data ?? []).filter((x) => x.ended_at).length === 0 ? <EmptyState text="جلساتك المنتهية تظهر هنا." /> : (
        <div className="space-y-3">
          {ss.data!.filter((x) => x.ended_at).map((x) => {
            const tr = pnlBetween(x.started_at, x.ended_at);
            const pnl = tr.reduce((a, y) => a + (Number(y.pnl) || 0), 0);
            return (
              <div key={x.id} className="panel p-4 text-sm">
                <div className="flex flex-wrap justify-between gap-2"><span>{fmtDate(x.started_at)} · {dur(+new Date(x.ended_at!) - +new Date(x.started_at))} · {x.mood}</span>
                  <span className="flex items-center gap-3"><span className={`font-data ${pnl >= 0 ? "text-success" : "text-destructive"}`} dir="ltr">{fmtMoney(pnl, cur)}</span><Button size="sm" variant="ghost" onClick={() => del(x.id)}>حذف</Button></span></div>
                {x.plan && <p className="mt-2 text-muted-foreground">الخطة: {x.plan}</p>}
                {x.review && <p className="mt-1">المراجعة: {x.review}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
