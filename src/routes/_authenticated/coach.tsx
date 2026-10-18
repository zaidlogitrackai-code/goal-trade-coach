import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Crosshair, Menu, Plus } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DeleteThreadButton } from "@/components/delete-thread-button";
import { SessionAgent } from "@/components/session-agent";
import { COACH_DRAFT_KEY } from "@/components/dashboard/quick-coach";
import { isPendingDelete } from "@/lib/undo-delete";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { currentUserId } from "@/lib/queries";
import { isFocusEmpty } from "@/lib/focus";
import { focusQuery } from "@/lib/focus-store";

export const Route = createFileRoute("/_authenticated/coach")({
  head: () => ({ meta: [{ title: "سَنَد — شريكك ضد الطمع" }, { name: "description", content: "شريكك ضد الطمع ومساعدك في كل شيء، يدير نظامك كامل." }] }),
  component: CoachPage,
});

const SUGGESTIONS = ["راجع آخر صفقاتي وقل لي وين أغلط", "اسألني عن أهدافي وحدودي", "ساعدني أكتب قواعد استراتيجيتي"];
const EMPTY = { text: "شو بدك نشتغل عليه اليوم؟", starters: SUGGESTIONS };

type Draft = { threadId: string; text: string; image: string | null };

function readDraft(): { text: string; image: string | null } | null {
  const raw = sessionStorage.getItem(COACH_DRAFT_KEY);
  sessionStorage.removeItem(COACH_DRAFT_KEY);
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as { text?: unknown; image?: unknown };
    return typeof d.text === "string" && d.text.trim() ? { text: d.text, image: typeof d.image === "string" ? d.image : null } : null;
  } catch { return null; }
}

/** سَنَد's own conversations: a thread list around the shared SessionAgent chat. */
function CoachPage() {
  const qc = useQueryClient();
  const [active, setActive] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Until the boot below has decided which chat opens (a home-page draft gets a fresh one).
  const [opening, setOpening] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [auto, setAuto] = useState(true);
  useEffect(() => { if (localStorage.getItem("coach-auto") === "off") setAuto(false); }, []);
  function toggleAuto() {
    const next = !auto;
    setAuto(next);
    localStorage.setItem("coach-auto", next ? "on" : "off");
  }

  const focus = useQuery(focusQuery);
  const threads = useQuery({
    queryKey: ["threads"],
    queryFn: async () => {
      const { data, error } = await supabase.from("coach_threads").select("*").order("updated_at", { ascending: false });
      if (error) throw error;
      // Session and risk-guardian chats live on their own pages.
      return data.filter((t) => !isPendingDelete(t.id) && !["حارس المخاطر", "مدرّب الاستراتيجية", "تدريب الذكاء", "حارس الانضباط"].some((b) => t.title === b || t.title.startsWith(`${b} · `)) && !t.title.startsWith("المحلل الذكي") && !/^جلسة( \d{4}-\d{2}-\d{2}| · .*)$/.test(t.title));
    },
  });

  const creating = useRef(false);
  async function newThread(): Promise<string | undefined> {
    if (creating.current) return undefined;
    creating.current = true;
    try {
      const user_id = await currentUserId();
      const { data, error } = await supabase.from("coach_threads").insert({ user_id }).select().single();
      if (error) { toast.error("ما قدرت أنشئ محادثة"); return undefined; }
      await qc.invalidateQueries({ queryKey: ["threads"] });
      setActive(data.id);
      return data.id;
    } finally { creating.current = false; }
  }

  // A message sent from the home page box: open a fresh chat and send it there once.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current || threads.isLoading) return;
    booted.current = true;
    const d = readDraft();
    if (!d) { setOpening(false); return; }
    void newThread().then((threadId) => { if (threadId) setDraft({ threadId, ...d }); }).finally(() => setOpening(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads.isLoading]);

  // Otherwise the newest chat; with none at all (first visit, last one deleted) a fresh one to type in.
  useEffect(() => {
    if (opening || active || !threads.isSuccess) return;
    if (threads.data.length) setActive(threads.data[0]!.id);
    else void newThread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening, active, threads.isSuccess, threads.data]);

  const activeTitle = threads.data?.find((t) => t.id === active)?.title ?? "محادثة جديدة";

  const focusBox = focus.data && (
    <Link
      to="/dashboard"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground hover:border-primary/40"
    >
      <Crosshair className="size-3.5 text-primary" aria-hidden="true" />
      {isFocusEmpty(focus.data) ? (
        <span>المدرب لسا ما بيعرف سوقك وهدفك ونقطة ضعفك. احكيله عنهم وهو بيحفظهم.</span>
      ) : (
        <>
          <span className="font-medium text-foreground">مركّز معك على:</span>
          {focus.data.markets.length > 0 && <span dir="ltr" className="font-data">{focus.data.markets.join(" · ")}</span>}
          {focus.data.weakness && <span>الضعف: {focus.data.weakness}</span>}
          {focus.data.goal && <span>الهدف: {focus.data.goal}</span>}
        </>
      )}
    </Link>
  );

  const threadList = (onPick?: () => void) => (
    <div className="space-y-1">
      {(threads.data ?? []).length === 0 && <p className="p-3 text-sm text-muted-foreground">لا توجد محادثات بعد.</p>}
      {threads.data?.map((t) => (
        <div key={t.id} className={`flex items-center gap-1 rounded-xl ps-3 text-sm ${active === t.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent"}`}>
          <button className="min-h-11 min-w-0 flex-1 truncate text-start" onClick={() => { setActive(t.id); onPick?.(); }}>{t.title}</button>
          <DeleteThreadButton id={t.id} queryKey={["threads"]} {...(active === t.id ? { onRemoved: () => setActive(null) } : {})} />
        </div>
      ))}
    </div>
  );

  const autoToggle = (
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <label className="flex min-h-11 cursor-pointer items-center gap-2">
        <input type="checkbox" checked={auto} onChange={toggleAuto} className="size-5 accent-primary" />
        تنفيذ تلقائي
      </label>
      <span>{auto ? "بوابة التداول والتهدئة تبقى مفعّلة" : "كل إجراء يحتاج ضغطة موافقة"}</span>
    </div>
  );

  return (
    <div className="agent-page mx-auto w-full max-w-4xl">
      <div className="mb-2 grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button size="icon" variant="ghost" aria-label="المحادثات"><Menu className="size-5" /></Button>
          </SheetTrigger>
          <SheetContent side="right" className="flex w-[85%] flex-col gap-4 overflow-y-auto sm:max-w-sm">
            <SheetHeader><SheetTitle className="pr-8 text-right">المحادثات</SheetTitle></SheetHeader>
            <Button onClick={() => { void newThread(); setSheetOpen(false); }} className="w-full"><Plus className="size-4" /> محادثة جديدة</Button>
            {focusBox}
            {autoToggle}
            {threadList(() => setSheetOpen(false))}
          </SheetContent>
        </Sheet>
        <div className="min-w-0 text-center">
          <p className="truncate text-sm font-semibold lg:text-base">{activeTitle}</p>
          <p className="text-xs text-muted-foreground">سَنَد · شريكك ضد الطمع</p>
        </div>
        <Button size="icon" variant="ghost" aria-label="محادثة جديدة" onClick={() => void newThread()}><Plus className="size-5" /></Button>
      </div>

      {active && (
        <SessionAgent
          key={active}
          threadId={active}
          quick={[]}
          auto={auto}
          empty={EMPTY}
          placeholder="اكتب رسالتك…"
          draft={draft?.threadId === active ? draft : null}
          onSent={() => void qc.invalidateQueries({ queryKey: ["threads"] })}
        />
      )}
    </div>
  );
}
