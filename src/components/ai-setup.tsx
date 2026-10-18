import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Md } from "@/components/md";
import { AgentActions, type StoredAction } from "@/components/agent-actions";
import { setupPlan } from "@/lib/ai.functions";

/** First-login: user describes everything in their own words; AI prepares settings, strategies and rules for approval. */
export function AiSetup({ onFinished }: { onFinished?: () => void }) {
  const run = useServerFn(setupPlan);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ reply: string; actions: StoredAction[] } | null>(null);

  async function go() {
    if (!text.trim()) { toast.error("اكتب لي عن نظامك أول"); return; }
    setBusy(true);
    try {
      const r = await run({ data: { text } });
      setRes({ reply: r!.reply, actions: r!.actions as StoredAction[] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "تعذّر الفهم"); }
    finally { setBusy(false); }
  }

  return (
    <section className="panel space-y-3 p-5">
      <div className="flex items-center gap-2"><Wand2 className="size-4" /><h2 className="font-semibold">خل الذكاء الاصطناعي يجهّز كل شيء عنك</h2></div>
      <p className="text-sm text-muted-foreground">اكتب بكلامك: رصيدك، هدفك اليومي والأسبوعي والشهري، حد الخسارة، كم صفقة باليوم، استراتيجياتك، وقواعدك. وهو يعبّي النظام كله وتوافق عليه.</p>
      <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)}
        placeholder="مثال: رصيدي 10000 دولار، هدفي 100 باليوم و500 بالأسبوع و2000 بالشهر. ما أخسر أكثر من 150 باليوم. 3 صفقات بالكثير. أتداول الذهب على فريم 15 دقيقة باستراتيجية كسر الترند… قواعدي: ما أدخل وقت الأخبار، ولازم ستوب لكل صفقة." />
      <Button onClick={go} disabled={busy}>{busy ? "جارٍ الفهم…" : "جهّز نظامي"}</Button>
      {res && (
        <div className="space-y-2 rounded-xl bg-muted p-4 text-sm leading-7">
          <Md>{res.reply}</Md>
          <AgentActions key={res.reply} actions={res.actions} onChange={(next) => {
            // Every card answered and at least one accepted; rejecting all is not a finished setup.
            if (next.every((a) => a.status) && next.some((a) => a.status === "done")) onFinished?.();
          }} />
        </div>
      )}
    </section>
  );
}
