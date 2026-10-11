import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ImagePlus, Plus, Trash2, X } from "lucide-react";
import { AgentActions, type StoredAction } from "@/components/agent-actions";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Md } from "@/components/md";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { coachReply } from "@/lib/ai.functions";
import { currentUserId } from "@/lib/queries";
import { prepareImage } from "@/lib/image";

export const Route = createFileRoute("/_authenticated/coach")({
  head: () => ({ meta: [{ title: "المدرب الذكي — نظام هادي" }, { name: "description", content: "مدرب شخصي يتكلم معك بالعربي ويعرف صفقاتك وقواعدك." }] }),
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
  async function pick(file?: File) {
    if (!file) return;
    try { setImage(await prepareImage(file)); } catch (e) { toast.error(e instanceof Error ? e.message : "ما قدرت أقرأ الصورة"); }
  }
  const endRef = useRef<HTMLDivElement>(null);

  const threads = useQuery({
    queryKey: ["threads"],
    queryFn: async () => {
      const { data, error } = await supabase.from("coach_threads").select("*").order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
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

  async function submit() {
    const msg = text.trim();
    if (!msg || busy) return;
    setBusy(true);
    try {
      const id = active ?? (await newThread());
      if (!id) return;
      const img = image;
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

  const list = msgs.data ?? [];
  const showPending = pending && !list.some((m) => m.role === "user" && m.content === pending && list[list.length - 1]?.role === "assistant");

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="المدرب الذكي" subtitle={auto ? "قل له شو بدك، وهو ينفّذ. الحذف وتخفيف حدود المخاطر بس بيحتاجوا موافقتك." : "يحلل معك، ينصحك، ويجهّز لك الإجراءات لتوافق عليها."} action={<Button onClick={newThread}><Plus className="size-4" /> محادثة جديدة</Button>} />
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <div className="panel max-h-[70vh] space-y-1 overflow-y-auto p-2">
          {(threads.data ?? []).length === 0 && <p className="p-3 text-sm text-muted-foreground">لا توجد محادثات بعد.</p>}
          {threads.data?.map((t) => (
            <div key={t.id} className={`group flex items-center gap-1 rounded-md px-3 py-2 text-sm ${active === t.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent"}`}>
              <button className="flex-1 truncate text-right" onClick={() => setActive(t.id)}>{t.title}</button>
              <button aria-label="حذف" onClick={() => del(t.id)} className="opacity-60 hover:opacity-100"><Trash2 className="size-3.5" /></button>
            </div>
          ))}
        </div>
        <div className="panel flex h-[70vh] flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {list.length === 0 && !pending && (
              <div className="py-16 text-center text-sm text-muted-foreground">ابدأ بسؤال، مثلاً: "راجع آخر صفقاتي وقل لي وين أغلط" أو "ساعدني أكتب قواعد دخول لاستراتيجيتي".</div>
            )}
            {list.map((m) => (
              <div key={m.id} className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-4 py-3 text-sm leading-7 ${m.role === "user" ? "mr-auto bg-primary text-primary-foreground" : "ml-auto bg-muted"}`}>{m.role === "assistant" ? <Md>{m.content}</Md> : m.content}
                {m.role === "assistant" && Array.isArray(m.actions) && m.actions.length > 0 && (
                  <AgentActions key={m.id} actions={m.actions as unknown as StoredAction[]} {...(auto && m.id === freshId ? { autoRunKey: m.id } : {})} onChange={async (next) => { await supabase.from("coach_messages").update({ actions: next as never }).eq("id", m.id); }} />
                )}
              </div>
            ))}
            {showPending && <div className="mr-auto max-w-[85%] whitespace-pre-wrap rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground">{pending}</div>}
            {busy && <div className="ml-auto rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">يكتب…</div>}
            <div ref={endRef} />
          </div>
          {image && (
            <div className="relative mx-3 mt-3 w-fit">
              <img src={image} alt="الصورة المرفقة" className="max-h-24 rounded-lg border border-border" />
              <button type="button" aria-label="حذف الصورة" onClick={() => setImage(null)} className="absolute -top-2 -left-2 rounded-full bg-secondary p-1"><X className="size-3" /></button>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 border-t border-border px-3 pt-2 text-xs text-muted-foreground">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={auto} onChange={toggleAuto} className="accent-primary" />
              تنفيذ تلقائي
            </label>
            <span>{auto ? "بوابة التداول والتهدئة تبقى مفعّلة" : "كل إجراء يحتاج ضغطة موافقة"}</span>
          </div>
          <div className="flex gap-2 p-3">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
            <Button type="button" variant="secondary" aria-label="إرفاق صورة" onClick={() => fileRef.current?.click()}><ImagePlus className="size-4" /></Button>
            <Textarea onPaste={(e) => void pick(Array.from(e.clipboardData.files)[0])} rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="اكتب أي شيء: صفقة، استراتيجية، هدف، سؤال… وأنا أجهّز لك التنفيذ" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
            <Button onClick={submit} disabled={busy || !text.trim()}>إرسال</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
