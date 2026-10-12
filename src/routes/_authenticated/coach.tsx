import { rememberChatImage } from "@/lib/agent-actions";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, Crosshair, ImagePlus, Menu, Plus, SendHorizontal, Trash2, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { AgentActions, type StoredAction } from "@/components/agent-actions";
import { supabase } from "@/integrations/supabase/client";
import { Md } from "@/components/md";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { coachReply } from "@/lib/ai.functions";
import { currentUserId } from "@/lib/queries";
import { prepareImage } from "@/lib/image";
import { isFocusEmpty } from "@/lib/focus";
import { focusQuery } from "@/lib/focus-store";

export const Route = createFileRoute("/_authenticated/coach")({
  head: () => ({ meta: [{ title: "سَنَد — شريكك ضد الطمع" }, { name: "description", content: "شريكك ضد الطمع ومساعدك في كل شيء، يدير نظامك كامل." }] }),
  component: CoachPage,
});

function CoachPage() {
  const qc = useQueryClient();
  const send = useServerFn(coachReply);
  const [active, setActive] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // The assistant message whose actions should auto-run (only the reply we just received).
  const [freshId, setFreshId] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  useEffect(() => { if (localStorage.getItem("coach-auto") === "off") setAuto(false); }, []);
  function toggleAuto() {
    const next = !auto;
    setAuto(next);
    localStorage.setItem("coach-auto", next ? "on" : "off");
  }
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  async function pick(file?: File) {
    if (!file) return;
    try { setImage(await prepareImage(file)); } catch (e) { toast.error(e instanceof Error ? e.message : "ما قدرت أقرأ الصورة"); }
  }
  const endRef = useRef<HTMLDivElement>(null);

  const focus = useQuery(focusQuery);
  const threads = useQuery({
    queryKey: ["threads"],
    queryFn: async () => {
      const { data, error } = await supabase.from("coach_threads").select("*").order("updated_at", { ascending: false });
      if (error) throw error;
      // Session and risk-guardian chats live on their own pages.
      return data.filter((t) => t.title !== "حارس المخاطر" && t.title !== "مدرّب الاستراتيجية" && t.title !== "حارس الانضباط" && !t.title.startsWith("المحلل الذكي") && !/^جلسة \d{4}-\d{2}-\d{2}$/.test(t.title));
    },
  });
  const msgs = useQuery({
    queryKey: ["messages", active],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase.from("coach_messages").select("*").eq("thread_id", active!).order("created_at");
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => { if (!active && threads.data?.length) setActive(threads.data[0]!.id); }, [threads.data, active]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.data, pending]);

  async function newThread() {
    const user_id = await currentUserId();
    const { data, error } = await supabase.from("coach_threads").insert({ user_id }).select().single();
    if (error) { toast.error("ما قدرت أنشئ محادثة"); return undefined; }
    await qc.invalidateQueries({ queryKey: ["threads"] });
    setActive(data.id);
    return data.id;
  }

  async function del(id: string) {
    const { error } = await supabase.from("coach_threads").delete().eq("id", id);
    if (error) { toast.error("ما قدرت أحذف"); return; }
    if (active === id) setActive(null);
    qc.invalidateQueries({ queryKey: ["threads"] });
  }

  async function submit(draft?: { text: string; image: string | null }) {
    const msg = (draft?.text ?? text).trim();
    if (!msg || busy) return;
    setBusy(true);
    try {
      const id = draft ? await newThread() : active ?? (await newThread());
      if (!id) return;
      const img = draft ? draft.image : image;
    rememberChatImage(img);
      setText(""); setImage(null); setPending(msg);
      const res = await send({ data: { threadId: id, message: msg, ...(img ? { image: img } : {}) } });
      if (res?.messageId) setFreshId(res.messageId);
      await qc.invalidateQueries({ queryKey: ["messages", id] });
      qc.invalidateQueries({ queryKey: ["threads"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذّر الرد");
      if (active) qc.invalidateQueries({ queryKey: ["messages", active] });
    } finally { setBusy(false); setPending(null); }
  }

  // A message sent from the home page box: open a fresh chat and send it once.
  const draftDone = useRef(false);
  useEffect(() => {
    if (draftDone.current || threads.isLoading) return;
    draftDone.current = true;
    const raw = sessionStorage.getItem("coach-draft");
    if (!raw) return;
    sessionStorage.removeItem("coach-draft");
    try { void submit(JSON.parse(raw) as { text: string; image: string | null }); } catch { /* ignore bad draft */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads.isLoading]);

  const list = msgs.data ?? [];
  const showPending = pending && !list.some((m) => m.role === "user" && m.content === pending && list[list.length - 1]?.role === "assistant");

  const activeTitle = threads.data?.find((t) => t.id === active)?.title ?? "محادثة جديدة";
  const suggestions = ["راجع آخر صفقاتي وقل لي وين أغلط", "اسألني عن أهدافي وحدودي", "ساعدني أكتب قواعد استراتيجيتي"];

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
        <div key={t.id} className={`flex items-center gap-1 rounded-xl px-3 py-2.5 text-sm ${active === t.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent"}`}>
          <button className="min-w-0 flex-1 truncate text-right" onClick={() => { setActive(t.id); onPick?.(); }}>{t.title}</button>
          <button aria-label="حذف" onClick={() => del(t.id)} className="shrink-0 p-1 opacity-60 hover:opacity-100"><Trash2 className="size-3.5" /></button>
        </div>
      ))}
    </div>
  );

  const autoToggle = (
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <label className="flex cursor-pointer items-center gap-2">
        <input type="checkbox" checked={auto} onChange={toggleAuto} className="accent-primary" />
        تنفيذ تلقائي
      </label>
      <span>{auto ? "بوابة التداول والتهدئة تبقى مفعّلة" : "كل إجراء يحتاج ضغطة موافقة"}</span>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl">
        <div className="agent-page -mx-4 -mb-2 overflow-hidden lg:panel lg:mx-0 lg:mb-0">
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border/40 px-2 pb-2 lg:px-3 lg:py-2">
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
              <p className="text-[11px] text-muted-foreground">{busy ? "يكتب…" : "سَنَد · شريكك ضد الطمع"}</p>
            </div>
            <Button size="icon" variant="ghost" aria-label="محادثة جديدة" onClick={newThread}><Plus className="size-5" /></Button>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 lg:px-6 lg:py-5"><div className="mx-auto max-w-3xl space-y-4 lg:space-y-5">
            {list.length === 0 && !pending && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <p className="text-sm text-muted-foreground">شو بدك نشتغل عليه اليوم؟</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {suggestions.map((s) => (
                    <button key={s} onClick={() => setText(s)} className="rounded-full border border-border bg-muted/30 px-3 py-1.5 text-xs hover:bg-accent">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {list.map((m) => (
              <div key={m.id} className={m.role === "user"
                ? "ml-auto w-fit max-w-[82%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-md bg-primary px-3.5 py-2 text-sm leading-6 text-primary-foreground"
                : "w-full break-words px-0.5 text-sm leading-6 lg:leading-7"}>
                {m.role === "assistant" ? <Md>{m.content}</Md> : m.content}
                {m.role === "user" && "image" in m && typeof m.image === "string" && (
                  <img src={m.image} alt="الصورة المرفقة" className="mt-2 max-h-16 w-auto rounded-lg" />
                )}
                {m.role === "assistant" && Array.isArray(m.actions) && m.actions.length > 0 && (
                  <div className="mt-3 border-t border-border pt-3">
                    <AgentActions key={m.id} actions={m.actions as unknown as StoredAction[]} {...(auto && m.id === freshId ? { autoRunKey: m.id } : {})} onChange={async (next) => { await supabase.from("coach_messages").update({ actions: next as never }).eq("id", m.id); }} />
                  </div>
                )}
              </div>
            ))}
            {showPending && <div className="ml-auto w-fit max-w-[82%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-md bg-primary px-3.5 py-2.5 text-sm text-primary-foreground">{pending}</div>}
            {busy && <div className="mr-auto w-fit rounded-2xl rounded-tl-md bg-muted px-4 py-2.5 text-sm text-muted-foreground">يكتب…</div>}
            <div ref={endRef} />
          </div></div>

          {image && (
            <div className="relative mx-3 mt-2 w-fit">
              <img src={image} alt="الصورة المرفقة" className="max-h-20 rounded-lg border border-border" />
              <button type="button" aria-label="حذف الصورة" onClick={() => setImage(null)} className="absolute -top-2 -left-2 rounded-full bg-secondary p-1"><X className="size-3" /></button>
            </div>
          )}
          <div className="mx-auto flex w-full max-w-3xl items-end gap-2 px-3 pb-1 pt-2 lg:pb-4">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
            <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
            <Button type="button" size="icon" variant="secondary" className="shrink-0 rounded-full" aria-label="إرفاق صورة" onClick={() => fileRef.current?.click()}><ImagePlus className="size-4" /></Button>
            <Button type="button" size="icon" variant="secondary" className="shrink-0 rounded-full" aria-label="صوّر الشارت بالكاميرا" onClick={() => camRef.current?.click()}><Camera className="size-4" /></Button>
            <Textarea
              onPaste={(e) => void pick(Array.from(e.clipboardData.files)[0])}
              rows={1}
              value={text}
              onChange={(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`; }}
              placeholder="اكتب رسالتك…"
              className="max-h-32 min-h-10 flex-1 resize-none rounded-2xl py-2"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }}
            />
            <Button size="icon" className="shrink-0 rounded-full" aria-label="إرسال" onClick={() => submit()} disabled={busy || !text.trim()}><SendHorizontal className="size-4 rotate-180" /></Button>
          </div>
        </div>
    </div>
  );
}
