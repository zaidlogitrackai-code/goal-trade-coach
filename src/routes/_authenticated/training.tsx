import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Images, ThumbsDown, ThumbsUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ChatHeader } from "@/components/app-shell";
import { useAgentChats } from "@/components/agent-chats";
import { SessionAgent } from "@/components/session-agent";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { strategiesQuery } from "@/lib/queries";
import { trainingScore } from "@/lib/training";

export const Route = createFileRoute("/_authenticated/training")({
  head: () => ({
    meta: [
      { title: "تدريب الذكاء — نظام هادي" },
      { name: "description", content: "درّب الذكاء الاصطناعي على استراتيجيتك بالأمثلة والشارتات." },
      { property: "og:title", content: "تدريب الذكاء — نظام هادي" },
      { property: "og:description", content: "درّب الذكاء الاصطناعي على استراتيجيتك بالأمثلة والشارتات." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TrainingPage,
});

const THREAD = "تدريب الذكاء";
const GREETING = "هلا هادي، هنا **مكان تدريبي على استراتيجيتك**.\n\nعلّمني خطوة خطوة، وارفع لي شارتات وقل لي «هذا دخول صح» أو «هذا غلط» وليش. كل اللي أتعلّمه يستخدمه المحلل وسَنَد بعدين.";
const QUICK = ["علّمك استراتيجيتي", "هذا دخول صح", "هذا دخول غلط", "اختبرني", "وش ناقصك تتعلّم؟"];

const examplesQuery = {
  queryKey: ["strategy_examples"],
  queryFn: async () => {
    const { data, error } = await supabase.from("strategy_examples").select("id,verdict,reason,symbol,timeframe,image,created_at").order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  },
};

function TrainingPage() {
  const qc = useQueryClient();
  const { data: strategies } = useQuery(strategiesQuery);
  const { data: examples } = useQuery(examplesQuery);
  const list = examples ?? [];
  const score = trainingScore({ strategies: strategies ?? [], examples: list });
  const { c, controls } = useAgentChats(THREAD, GREETING);
  const good = list.filter((e) => e.verdict === "good").length;
  return (
    <div className="agent-page mx-auto w-full max-w-4xl">
      <ChatHeader
        status={
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted lg:w-28">
              <span className="block h-full bg-primary transition-all" style={{ width: `${score}%` }} />
            </span>
            {score}% · {good} صح · {list.length - good} غلط
          </span>
        }
        actions={<>
          {controls}
          <Sheet>
            <SheetTrigger asChild>
              <Button size="icon" variant="secondary" className="size-9 rounded-full" aria-label="أمثلة التدريب"><Images className="size-4" /></Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[92%] overflow-y-auto sm:max-w-xl">
              <SheetHeader><SheetTitle>أمثلة التدريب</SheetTitle></SheetHeader>
              <div className="mt-4 space-y-3">
                {list.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">لا توجد بيانات بعد — ارفع شارت في المحادثة وقل صح أو غلط.</p>
                ) : list.map((e) => (
                  <div key={e.id} className="panel flex gap-3 p-3">
                    {e.image && <img src={e.image} alt="" className="size-16 shrink-0 rounded-md object-cover" />}
                    <div className="min-w-0 space-y-1 text-sm">
                      <p className={`flex items-center gap-1 font-semibold ${e.verdict === "good" ? "text-success" : "text-destructive"}`}>
                        {e.verdict === "good" ? <ThumbsUp className="size-3.5" /> : <ThumbsDown className="size-3.5" />}
                        {e.verdict === "good" ? "دخول صحيح" : "دخول غلط"}
                        {(e.symbol || e.timeframe) && <span dir="ltr" className="ms-1 text-xs font-normal text-muted-foreground">{[e.symbol, e.timeframe].filter(Boolean).join(" ")}</span>}
                      </p>
                      <p className="text-xs leading-relaxed text-muted-foreground">{e.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            </SheetContent>
          </Sheet>
        </>}
      />
      {c && <SessionAgent
        key={c}
        threadId={c}
        hasActive={false}
        title={THREAD}
        greeting={GREETING}
        quick={QUICK}
        mode="training"
        placeholder="علّم الذكاء استراتيجيتك…"
        onChanged={() => {
          qc.invalidateQueries({ queryKey: ["strategy_examples"] });
          qc.invalidateQueries({ queryKey: ["strategies"] });
        }}
      />}
    </div>
  );
}
