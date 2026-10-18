import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FlaskConical, History, MessageSquare, SquarePen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ChatHeader, EmptyState } from "@/components/app-shell";
import { Md } from "@/components/md";
import { SessionAgent } from "@/components/session-agent";
import { PaperTestPanel } from "@/components/paper-test-panel";
import { TradeCardView } from "@/components/trade-card";
import { splitTradeBlock } from "@/lib/trade-card";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DeleteThreadButton } from "@/components/delete-thread-button";
import { isPendingDelete } from "@/lib/undo-delete";
import { currentUserId, fmtDate } from "@/lib/queries";

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
  validateSearch: z.object({ c: z.string().uuid().optional().catch(undefined) }),
  component: AnalystPage,
});

export const ANALYST_THREAD = "المحلل الذكي";

const GREETING =
  "هلا هادي، أنا **المحلل الذكي**.\n\nارفع صورة الشارت (الذهب، الفضة، المؤشرات، العملات، أو النفط) وقل لي وش تفكر فيه. أحلله لك وأعطيك رأيي بصراحة، وبعدها نتناقش فيه.";
const QUICK = ["أعطني صفقة كاملة", "اقرأ لي السيولة (SMC)", "وين الـ POC ومناطق القيمة؟", "الفريم الأكبر وش يقول؟", "وش يلغي الفكرة؟", "يطابق استراتيجيتي؟"];

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
  // One dialog for the list: its trigger sits inside <summary>, which would also fold the row.
  const [asking, setAsking] = useState<string | null>(null);
  async function del(id: string) {
    const { error } = await supabase.from("chart_analyses").delete().eq("id", id);
    if (error) { toast.error("ما قدرت أحذف"); return; }
    qc.invalidateQueries({ queryKey: ["analyses"] });
  }
  if ((h.data ?? []).length === 0) return <EmptyState text="أول تحليل لك بيظهر هنا." />;
  return (
    <div className="space-y-3">
      <ConfirmDialog
        open={asking != null}
        onOpenChange={(o) => { if (!o) setAsking(null); }}
        title="تحذف هذا التحليل؟"
        description="ما ينحذف من محادثاتك، بس من التحليلات المحفوظة."
        confirmLabel="احذف"
        destructive
        onConfirm={() => { if (asking) void del(asking); }}
      />
      {h.data!.map((a) => (
        <details key={a.id} className="panel p-4">
          <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
            <span><span className="font-data font-semibold" dir="ltr">{a.symbol || "—"}</span> <span className="text-xs text-muted-foreground">{a.timeframe} · {fmtDate(a.created_at)}</span></span>
            <Button size="sm" variant="ghost" onClick={(e) => { e.preventDefault(); setAsking(a.id); }}>حذف</Button>
          </summary>
          {a.question && <p className="mt-3 text-sm text-muted-foreground">سؤالك: {a.question}</p>}
          <SavedAnalysis id={a.id} result={a.result} card={a.card} />
        </details>
      ))}
    </div>
  );
}

/** A saved analysis with its card; the card knows its row, so the stepper can link the trade back. */
function SavedAnalysis({ id, result, card }: { id: string; result: string; card: unknown }) {
  const { body, raw } = splitTradeBlock(result);
  const cardRaw = card != null ? JSON.stringify(card) : raw;
  return (
    <div className="mt-3">
      <Md>{body}</Md>
      {cardRaw && <TradeCardView raw={cardRaw} analysisId={id} />}
    </div>
  );
}

const threadsQuery = {
  queryKey: ["analyst-threads"],
  queryFn: async () => {
    const { data: threads, error } = await supabase
      .from("coach_threads").select("id,title,updated_at")
      .or(`title.eq.${ANALYST_THREAD},title.like.${ANALYST_THREAD} · %`)
      .order("updated_at", { ascending: false }).limit(50);
    if (error) throw error;
    const ids = threads.map((t) => t.id);
    const first = new Map<string, string>();
    if (ids.length) {
      const { data: msgs } = await supabase.from("coach_messages").select("thread_id,content").in("thread_id", ids).eq("role", "user").order("created_at").limit(400);
      for (const m of msgs ?? []) if (!first.has(m.thread_id)) first.set(m.thread_id, m.content.replace(/\n📎.*$/s, "").trim());
    }
    return threads.filter((t) => !isPendingDelete(t.id)).map((t) => ({ ...t, preview: first.get(t.id) || "" }));
  },
};

function Conversations({ activeId, onOpen, onClose, onActiveDeleted }: { activeId: string | undefined; onOpen: (id: string | undefined) => void; onClose: () => void; onActiveDeleted: () => void }) {
  const q = useQuery(threadsQuery);
  const list = q.data ?? [];
  if (list.length === 0) return <EmptyState text="محادثاتك مع المحلل بتظهر هنا." />;
  return (
    <ul className="space-y-1">
      {list.map((t) => {
        const main = t.title === ANALYST_THREAD;
        const active = activeId ? t.id === activeId : main;
        return (
          <li key={t.id} className={`group flex items-center gap-1 rounded-xl ${active ? "bg-accent" : "hover:bg-accent/60"}`}>
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-start" onClick={() => { onOpen(t.id); onClose(); }}>
              <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block truncate text-sm">{t.preview || "محادثة جديدة"}</span>
                <span className="block text-xs text-muted-foreground">{fmtDate(t.updated_at)}</span>
              </span>
            </button>
            <DeleteThreadButton id={t.id} queryKey={threadsQuery.queryKey} {...(active ? { onRemoved: onActiveDeleted } : {})} />
          </li>
        );
      })}
    </ul>
  );
}

function AnalystPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { c } = Route.useSearch();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState(false);

  // Switching chats replaces the entry: the nav bar's back chevron leaves the analyst, it
  // doesn't walk back through every chat opened here.
  function openThread(id: string | undefined) {
    void navigate({ to: "/analyst", search: id ? { c: id } : {}, replace: true });
  }

  // Opening the analyst (no ?c) always lands on a fresh chat, like ChatGPT.
  // Reuse the newest chat if it has no user message yet, so visits don't pile up empty chats.
  const booted = useRef(false);
  useEffect(() => {
    if (c) { booted.current = false; return; }
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      const { data: last } = await supabase.from("coach_threads").select("id").like("title", `${ANALYST_THREAD} · %`).order("created_at", { ascending: false }).limit(1);
      const lastId = last?.[0]?.id;
      if (lastId) {
        const { count } = await supabase.from("coach_messages").select("id", { count: "exact", head: true }).eq("thread_id", lastId).eq("role", "user");
        if (!count) { void navigate({ to: "/analyst", search: { c: lastId }, replace: true }); return; }
      }
      await startNew();
    })();
  }, [c]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startNew() {
    if (creating) return;
    setCreating(true);
    try {
      const user_id = await currentUserId();
      const stamp = new Date().toISOString();
      const { data, error } = await supabase.from("coach_threads").insert({ user_id, title: `${ANALYST_THREAD} · ${stamp}` }).select("id").single();
      if (error) throw error;
      await supabase.from("coach_messages").insert({ user_id, thread_id: data.id, role: "assistant", content: GREETING });
      await qc.invalidateQueries({ queryKey: ["analyst-threads"] });
      void navigate({ to: "/analyst", search: { c: data.id }, replace: true });
    } catch { toast.error("ما قدرت أبدأ محادثة جديدة"); }
    finally { setCreating(false); }
  }

  return (
    <div className="agent-page mx-auto w-full max-w-4xl">
      <ChatHeader
        status="ارفع الشارت وتناقش معه — القرار النهائي لك"
        actions={<>
          <Button size="icon" variant="secondary" className="size-9 rounded-full" aria-label="اختبار ذاتي تجريبي" title="اختبار ذاتي 10 دقائق" onClick={() => setTesting(true)}><FlaskConical className="size-4" /></Button>
          <Button size="icon" variant="secondary" className="size-9 rounded-full" aria-label="محادثة جديدة" disabled={creating} onClick={() => void startNew()}><SquarePen className="size-4" /></Button>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button size="icon" variant="secondary" className="size-9 rounded-full" aria-label="سجل المحادثات"><History className="size-4" /></Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[92%] overflow-y-auto sm:max-w-md">
              <SheetHeader><SheetTitle>سجل المحادثات</SheetTitle></SheetHeader>
              <Button className="mt-4 w-full gap-2" disabled={creating} onClick={() => { setOpen(false); void startNew(); }}><SquarePen className="size-4" /> محادثة جديدة</Button>
              <div className="mt-4"><Conversations activeId={c} onOpen={openThread} onClose={() => setOpen(false)} onActiveDeleted={() => void startNew()} /></div>
              <h3 className="mb-3 mt-8 text-sm font-semibold text-muted-foreground">التحليلات المحفوظة</h3>
              <PastAnalyses />
            </SheetContent>
          </Sheet>
        </>}
      />
      {c && testing && <PaperTestPanel threadId={c} onClose={() => setTesting(false)} />}
      {c && <SessionAgent
        key={c}
        {...(c ? { threadId: c } : {})}
        hasActive={false}
        title={ANALYST_THREAD}
        greeting={GREETING}
        quick={QUICK}
        mode="analyst"
        brief
        placeholder="ارفع الشارت أو اسأل المحلل…"
        onChanged={() => { qc.invalidateQueries({ queryKey: ["analyses"] }); qc.invalidateQueries({ queryKey: ["analyst-threads"] }); }}
      />}
    </div>
  );
}
