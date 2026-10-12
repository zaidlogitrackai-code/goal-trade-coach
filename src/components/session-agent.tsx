import { rememberChatImage } from "@/lib/agent-actions";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ImagePlus, Mic, SendHorizontal, Square, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AgentActions, type StoredAction } from "@/components/agent-actions";
import { Md } from "@/components/md";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { coachReply, transcribeAudio } from "@/lib/ai.functions";
import { currentUserId } from "@/lib/queries";
import { prepareImage } from "@/lib/image";

function todayTitle() {
  return `جلسة ${new Date().toLocaleDateString("en-CA")}`;
}

const GREETING_START =
  "هلا هادي\n\n**اليوم بتتداول؟** إذا إي، قل لي **كم التارقت عندك اليوم** وأي أسواق بتراقب، وأنا أبدأ لك الجلسة وأنظمها.\n\nرد كتابة، أو ارفع صورة، أو أرسل رسالة صوتية";

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rej(new Error("ما قدرت أقرأ التسجيل"));
    r.readAsDataURL(b);
  });
}

export interface AgentChatProps {
  hasActive: boolean;
  onChanged: () => void;
  /** Fixed thread title; defaults to today's session thread. */
  title?: string;
  greeting?: string;
  quick?: string[];
  mode?: "coach" | "risk" | "strategy" | "discipline" | "analyst";
  placeholder?: string;
  onReady?: (threadId: string) => void;
}

export function SessionAgent({ hasActive, onChanged, title, greeting, quick: quickProp, mode, placeholder, onReady }: AgentChatProps) {
  const threadTitle = title ?? todayTitle();
  const qc = useQueryClient();
  const send = useServerFn(coachReply);
  const transcribe = useServerFn(transcribeAudio);
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [auto, setAuto] = useState(true);
  const recRef = useRef<MediaRecorder | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const boot = useRef(false);

  useEffect(() => { if (localStorage.getItem("coach-auto") === "off") setAuto(false); }, []);

  // Find (or create once) today's session thread, opened by the agent's question.
  const thread = useQuery({
    queryKey: ["session-thread", threadTitle],
    queryFn: async () => {
      const { data, error } = await supabase.from("coach_threads").select("id").eq("title", threadTitle).order("created_at").limit(1);
      if (error) throw error;
      return data[0]?.id ?? null;
    },
  });

  useEffect(() => {
    if (thread.isLoading || thread.data || boot.current) return;
    boot.current = true;
    (async () => {
      const user_id = await currentUserId();
      const { data, error } = await supabase.from("coach_threads").insert({ user_id, title: threadTitle }).select("id").single();
      if (error) { toast.error("ما قدرت أجهز محادثة الجلسة"); return; }
      const content = greeting ?? (hasActive ? "هلا هادي جلستك شغالة. احكيلي عن أي صفقة أو ارفع صورتها، ولما تخلص قل لي \"خلصت\" وأسوي معك المراجعة." : GREETING_START);
      await supabase.from("coach_messages").insert({ user_id, thread_id: data.id, role: "assistant", content });
      await qc.invalidateQueries({ queryKey: ["session-thread"] });
    })();
  }, [thread.isLoading, thread.data, hasActive, qc, threadTitle, greeting]);

  useEffect(() => { if (thread.data) onReady?.(thread.data); }, [thread.data, onReady]);

  const id = thread.data ?? null;
  const msgs = useQuery({
    queryKey: ["messages", id],
    enabled: !!id,
    // Agent messages written elsewhere (morning note, watcher alerts) appear without a reload.
    refetchInterval: busy ? false : 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("coach_messages").select("*").eq("thread_id", id!).order("created_at");
      if (error) throw error;
      return data;
    },
  });
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [msgs.data, pending, busy]);

  async function submit(override?: string) {
    const msg = (override ?? text).trim() || (image ? "شوف هذي الصورة" : "");
    if (!msg || busy || !id) return;
    setBusy(true);
    const img = image;
    rememberChatImage(img);
    setText(""); setImage(null); setPending(msg);
    try {
      const res = await send({ data: { threadId: id, message: msg, ...(img ? { image: img } : {}), ...(mode ? { mode } : {}) } });
      if (res?.messageId) setFreshId(res.messageId);
      await qc.invalidateQueries({ queryKey: ["messages", id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذّر الرد");
      qc.invalidateQueries({ queryKey: ["messages", id] });
    } finally { setBusy(false); setPending(null); }
  }

  async function toggleRecord() {
    if (recording) { recRef.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 1000) { toast.error("التسجيل قصير جدًا"); return; }
        setBusy(true); setPending("رسالة صوتية…");
        try {
          const { text: heard } = await transcribe({ data: { audio: await blobToBase64(blob), mime: blob.type || "audio/webm" } });
          setBusy(false); setPending(null);
          await submit(heard);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "ما قدرت أفهم التسجيل");
          setBusy(false); setPending(null);
        }
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch { toast.error("اسمح للموقع باستخدام المايك عشان ترسل رسالة صوتية"); }
  }

  const list = msgs.data ?? [];
  const showPending = pending && !list.some((m) => m.role === "user" && m.content === pending);
  const quick = quickProp ?? (hasActive ? ["خلصت، سكّر الجلسة", "أبي أدخل صفقة"] : ["إي بتداول اليوم", "لا، ما بتداول اليوم"]);

  return (
    <div className="-mx-4 -mb-2 flex min-h-0 flex-1 flex-col overflow-hidden lg:panel lg:mx-0 lg:mb-0">
      <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
        {list.map((m) => (
          <div key={m.id} className={m.role === "user"
            ? "ml-auto w-fit max-w-[82%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-md bg-primary px-3.5 py-2 text-sm leading-6 text-primary-foreground"
            : "w-full min-w-0 break-words text-sm leading-6"}>
            {m.role === "assistant" ? <Md>{m.content}</Md> : m.content}
            {m.role === "assistant" && Array.isArray(m.actions) && m.actions.length > 0 && (
              <div className="mt-3 border-t border-border pt-3">
                <AgentActions
                  key={m.id}
                  actions={m.actions as unknown as StoredAction[]}
                  {...(auto && m.id === freshId ? { autoRunKey: m.id } : {})}
                  onChange={async (next) => { await supabase.from("coach_messages").update({ actions: next as never }).eq("id", m.id); onChanged(); }}
                />
              </div>
            )}
          </div>
        ))}
        {showPending && <div className="ml-auto w-fit max-w-[82%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-md bg-primary px-3.5 py-2 text-sm text-primary-foreground">{pending}</div>}
        {busy && <div className="w-fit rounded-2xl bg-muted px-4 py-2 text-sm text-muted-foreground">يكتب…</div>}
        {!busy && list.length > 0 && (quickProp ? true : list.length < 4) && (
          <div className="flex flex-wrap gap-2">
            {quick.map((q) => (
              <button key={q} onClick={() => submit(q)} className="rounded-full border border-border bg-muted/30 px-3 py-1.5 text-xs hover:bg-accent">{q}</button>
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {image && (
        <div className="relative mx-3 mt-2 w-fit">
          <img src={image} alt="الصورة المرفقة" className="max-h-20 rounded-lg border border-border" />
          <button type="button" aria-label="حذف الصورة" onClick={() => setImage(null)} className="absolute -top-2 -left-2 rounded-full bg-secondary p-1"><X className="size-3" /></button>
        </div>
      )}
      <div className="flex shrink-0 items-end gap-2 px-3 pb-1 pt-2 lg:border-t lg:border-border/40 lg:p-3">
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { try { setImage(await prepareImage(f)); } catch (err) { toast.error(err instanceof Error ? err.message : "ما قدرت أقرأ الصورة"); } } }} />
        <Button type="button" size="icon" variant="secondary" className="size-10 shrink-0 rounded-full" aria-label="إرفاق صورة" onClick={() => fileRef.current?.click()}><ImagePlus className="size-4" /></Button>
        <Textarea
          rows={1}
          value={text}
          onChange={(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`; }}
          placeholder={recording ? "يسجّل… اضغط ■ للإرسال" : placeholder ?? "رد على المساعد…"}
          className="max-h-32 min-h-10 flex-1 resize-none rounded-2xl py-2"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }}
        />
        {text.trim() || image ? (
          <Button size="icon" className="size-10 shrink-0 rounded-full" aria-label="إرسال" onClick={() => submit()} disabled={busy}><SendHorizontal className="size-4 rotate-180" /></Button>
        ) : (
          <Button size="icon" variant={recording ? "destructive" : "default"} className={`size-10 shrink-0 rounded-full ${recording ? "animate-pulse" : ""}`} aria-label={recording ? "إيقاف وإرسال" : "رسالة صوتية"} onClick={toggleRecord} disabled={busy}>
            {recording ? <Square className="size-4" /> : <Mic className="size-4" />}
          </Button>
        )}
      </div>
    </div>
  );
}
