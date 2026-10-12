import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FlaskConical, Square, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { paperIdea, paperPrice } from "@/lib/ai.functions";
import { MARKET_SYMBOLS } from "@/lib/market-symbols";
import { currentUserId } from "@/lib/queries";
import { stepTrade, summarizeTest, TEST_MS, validScalp, type PaperTrade } from "@/lib/paper-test";

const POLL_MS = 10_000;

/** Analyst's 10-minute paper self-test: virtual scalps only, nothing is saved as a real trade. */
export function PaperTestPanel({ threadId, onClose }: { threadId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const getIdea = useServerFn(paperIdea);
  const getPrice = useServerFn(paperPrice);
  const [symbol, setSymbol] = useState("XAUUSD");
  const [running, setRunning] = useState(false);
  const [trades, setTrades] = useState<PaperTrade[]>([]);
  const [price, setPrice] = useState<number | null>(null);
  const [digits, setDigits] = useState(2);
  const [status, setStatus] = useState("");
  const [left, setLeft] = useState(TEST_MS);
  const stop = useRef(false);

  useEffect(() => () => { stop.current = true; }, []);

  async function run() {
    stop.current = false;
    setRunning(true); setTrades([]); setStatus("يقرأ الشارت…");
    const start = Date.now();
    let list: PaperTrade[] = [];
    let id = 0;
    const sync = () => setTrades([...list]);
    const end = start + TEST_MS;
    try {
      while (!stop.current && Date.now() < end) {
        setLeft(end - Date.now());
        const open = list.find((t) => !t.outcome);
        if (!open) {
          setStatus("يدوّر على صفقة سكالب…");
          const hist = list.map((t) => `${t.direction === "long" ? "شراء" : "بيع"} ${t.outcome} ${t.r}R`).join("، ");
          const idea = await getIdea({ data: { symbol, history: hist } });
          if (stop.current) break;
          setDigits(idea.digits);
          if (validScalp(idea.direction, idea.entry, idea.stop, idea.target)) {
            list = [...list, { id: ++id, symbol: idea.symbol, direction: idea.direction, entry: idea.entry, stop: idea.stop, target: idea.target, openedAt: Date.now(), reason: idea.reason }];
            sync();
            setStatus("يراقب الصفقة…");
          } else setStatus("الفكرة ما كانت منطقية، يحاول مرة ثانية…");
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
        const p = await getPrice({ data: { symbol } });
        setPrice(p.price);
        list = list.map((t) => stepTrade(t, p.price, Date.now()));
        sync();
      }
      const last = await getPrice({ data: { symbol } }).catch(() => null);
      if (last) list = list.map((t) => stepTrade(t, last.price, Date.now(), true));
      sync();
      await report(list, Date.now() - start);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "توقف الاختبار");
    } finally { setRunning(false); setStatus(""); setLeft(0); }
  }

  async function report(list: PaperTrade[], ms: number) {
    const s = summarizeTest(list);
    const lines = list.map((t) => `- ${t.direction === "long" ? "🟢 شراء" : "🔴 بيع"} ${t.entry.toFixed(digits)} → ${t.exit?.toFixed(digits)} · ${t.outcome === "tp" ? "هدف" : t.outcome === "sl" ? "وقف" : "انتهى الوقت"} · **${t.r}R** — ${t.reason}`);
    const content = `**نتيجة الاختبار التجريبي** (${symbol}، ${Math.round(ms / 60000)} دقائق، صفقات وهمية)\n\n${s.count} صفقات · ربح ${s.wins} · خسارة ${s.losses} · نسبة النجاح ${s.winRate}% · المجموع **${s.totalR}R**\n\n${lines.join("\n") || "ما لقيت صفقة منطقية."}`;
    const user_id = await currentUserId();
    await supabase.from("coach_messages").insert({ user_id, thread_id: threadId, role: "assistant", content });
    void qc.invalidateQueries();
  }

  const s = summarizeTest(trades);
  const mm = Math.floor(left / 60000), ss = Math.floor((left % 60000) / 1000);
  return (
    <div className="mb-2 shrink-0 rounded-2xl border border-border bg-card p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-semibold"><FlaskConical className="size-4" /> اختبار ذاتي 10 دقائق · صفقات وهمية</span>
        <Button size="icon" variant="ghost" className="size-7" aria-label="إغلاق" onClick={() => { stop.current = true; onClose(); }}><X className="size-4" /></Button>
      </div>
      {!running && trades.length === 0 && (
        <div className="mt-3 flex items-center gap-2">
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="h-9 rounded-xl border border-border bg-background px-2" dir="ltr">
            {MARKET_SYMBOLS.map((m) => <option key={m.key} value={m.key}>{m.key}</option>)}
          </select>
          <Button className="h-9" onClick={() => void run()}>ابدأ الاختبار</Button>
        </div>
      )}
      {(running || trades.length > 0) && (
        <div className="mt-2 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{running ? `${status} · باقي ${mm}:${String(ss).padStart(2, "0")}` : "انتهى الاختبار — النتيجة في المحادثة"}</span>
            <span dir="ltr">{price != null ? `${symbol} ${price.toFixed(digits)}` : ""} · {s.totalR}R</span>
          </div>
          {trades.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 rounded-xl bg-background/60 px-2.5 py-1.5 text-xs">
              <span className={t.direction === "long" ? "text-emerald-500" : "text-red-500"}>{t.direction === "long" ? "شراء" : "بيع"}</span>
              <span dir="ltr" className="font-data">{t.entry.toFixed(digits)} · SL {t.stop.toFixed(digits)} · TP {t.target.toFixed(digits)}</span>
              <span className={t.outcome ? ((t.r ?? 0) > 0 ? "text-emerald-500" : "text-red-500") : "text-sky-500"}>{t.outcome ? `${t.r}R` : "مفتوحة"}</span>
            </div>
          ))}
          {running && <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => { stop.current = true; }}><Square className="size-3" /> أوقف واعرض النتيجة</Button>}
        </div>
      )}
    </div>
  );
}
