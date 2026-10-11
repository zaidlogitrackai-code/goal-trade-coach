import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { coachReply } from "@/lib/ai.functions";
import { currentUserId } from "@/lib/queries";

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

  useEffect(() => { if (!active && threads.data?.length) setActive(threads.data[0].id); }, [threads.data, active]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.data, pending]);

  async function newThread() {
    const user_id = await currentUserId();
    const { data, error } = await supabase.from("coach_threads").insert({ user_id }).select().single();
    if (error) return toast.error("ما قدرت أنشئ محادثة");
    await qc.invalidateQueries({ queryKey: ["threads"] });
    setActive(data.id);
    return data.id;
  }

  async function del(id: string) {
    const { error } = await supabase.from("coach_threads").delete().eq("id", id);
    if (error) return toast.error("ما قدرت أحذف");
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
      setText(""); setPending(msg);
      await send({ data: { threadId: id, message: msg } });
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
      <PageHeader title="المدرب الذكي" subtitle="اسأله عن صفقاتك، قواعدك، أو كيف تبني خطتك." action={<Button onClick={newThread}><Plus className="size-4" /> محادثة جديدة</Button>} />
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
              <div key={m.id} className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-4 py-3 text-sm leading-7 ${m.role === "user" ? "mr-auto bg-primary text-primary-foreground" : "ml-auto bg-muted"}`}>{m.content}</div>
            ))}
            {showPending && <div className="mr-auto max-w-[85%] whitespace-pre-wrap rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground">{pending}</div>}
            {busy && <div className="ml-auto rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">يكتب…</div>}
            <div ref={endRef} />
          </div>
          <div className="flex gap-2 border-t border-border p-3">
            <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="اكتب رسالتك…" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
            <Button onClick={submit} disabled={busy || !text.trim()}>إرسال</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
