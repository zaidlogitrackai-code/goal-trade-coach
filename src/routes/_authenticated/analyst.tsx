import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { History, ScanSearch } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState } from "@/components/app-shell";
import { Md } from "@/components/md";
import { SessionAgent } from "@/components/session-agent";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { fmtDate } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/analyst")({
  head: () => ({
    meta: [
      { title: "المحلل الذكي — نظام هادي" },
      { name: "description", content: "تناقش مع المحلل الذكي على شارتاتك واحصل على رأيه بدقة." },
      { property: "og:title", content: "المحلل الذكي — نظام هادي" },
      { property: "og:description", content: "تناقش مع المحلل الذكي على شارتاتك واحصل على رأيه بدقة." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AnalystPage,
});

export const ANALYST_THREAD = "المحلل الذكي";

const GREETING =
  "هلا هادي، أنا **المحلل الذكي**.\n\nارفع صورة الشارت (الذهب، الفضة، المؤشرات، العملات، أو النفط) وقل لي وش تفكر فيه. أحلله لك وأعطيك رأيي بصراحة، وبعدها نتناقش فيه.";
const QUICK = ["وش رأيك أدخل؟", "وين الوقف والهدف؟", "وش السيناريو المعاكس؟", "يطابق استراتيجيتي؟"];

const historyQuery = {
  queryKey: ["analyses"],
  queryFn: async () => {
    const { data, error } = await supabase.from("chart_analyses").select("*").order("created_at", { ascending: false }).limit(30);
    if (error) throw error;
    return data;
  },
};

function PastAnalyses() {
  const qc = useQueryClient();
  const h = useQuery(historyQuery);
  async function del(id: string) {
    const { error } = await supabase.from("chart_analyses").delete().eq("id", id);
    if (error) { toast.error("ما قدرت أحذف"); return; }
    qc.invalidateQueries({ queryKey: ["analyses"] });
  }
  if ((h.data ?? []).length === 0) return <EmptyState text="أول تحليل لك بيظهر هنا." />;
  return (
    <div className="space-y-3">
      {h.data!.map((a) => (
        <details key={a.id} className="panel p-4">
          <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
            <span><span className="font-data font-semibold" dir="ltr">{a.symbol || "—"}</span> <span className="text-xs text-muted-foreground">{a.timeframe} · {fmtDate(a.created_at)}</span></span>
            <Button size="sm" variant="ghost" onClick={(e) => { e.preventDefault(); void del(a.id); }}>حذف</Button>
          </summary>
          {a.question && <p className="mt-3 text-sm text-muted-foreground">سؤالك: {a.question}</p>}
          <div className="mt-3"><Md>{a.result}</Md></div>
        </details>
      ))}
    </div>
  );
}

function AnalystPage() {
  const qc = useQueryClient();
  return (
    <div className="agent-page mx-auto w-full max-w-4xl">
      <div className="mb-2 grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <ScanSearch className="size-5 shrink-0" />
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg font-semibold lg:text-xl">المحلل الذكي</h1>
            <p className="truncate text-xs text-muted-foreground">ارفع الشارت وتناقش معه — القرار النهائي لك</p>
          </div>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button size="icon" variant="secondary" className="size-9 rounded-full" aria-label="التحليلات السابقة"><History className="size-4" /></Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[92%] overflow-y-auto sm:max-w-xl">
            <SheetHeader><SheetTitle>التحليلات السابقة</SheetTitle></SheetHeader>
            <div className="mt-4"><PastAnalyses /></div>
          </SheetContent>
        </Sheet>
      </div>
      <SessionAgent
        hasActive={false}
        title={ANALYST_THREAD}
        greeting={GREETING}
        quick={QUICK}
        mode="analyst"
        placeholder="ارفع الشارت أو اسأل المحلل…"
        onChanged={() => qc.invalidateQueries({ queryKey: ["analyses"] })}
      />
    </div>
  );
}
