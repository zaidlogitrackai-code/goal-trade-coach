import { rememberChatImage } from "@/lib/agent-actions";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { RotateCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { StoredAction } from "@/components/agent-actions";
import { MessageRow, TypingBubble, UserBubble, type ChatMessage } from "@/components/chat-message";
import { ChatComposer } from "@/components/chat-composer";
import { ImageLightbox, type LightboxImage } from "@/components/image-lightbox";
import { useChatScrollLock } from "@/hooks/use-visual-viewport";
import { coachReply, transcribeAudio } from "@/lib/ai.functions";
import { currentUserId, settingsQuery } from "@/lib/queries";
import { dayKey } from "@/lib/trading-day";
import { makeThumbnail } from "@/lib/image";
import { hasNewBelow, shouldAutoScroll } from "@/lib/chat-ui";
import { friendlyError, retryText, sendReliably, retryDecision, unansweredMessage } from "@/lib/chat-retry";
import { threadState } from "@/lib/chat-check";

/** One session thread per trading day, named by the trader's own calendar day. */
function todayTitle(tz: string | null | undefined) {
  return `جلسة ${dayKey(new Date(), tz)}`;
}

export const GREETING_START =
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
  hasActive?: boolean;
  onChanged?: () => void;
  /** Fixed thread title; defaults to today's session thread. */
  title?: string;
  greeting?: string;
  quick?: string[];
  mode?: "coach" | "risk" | "strategy" | "discipline" | "analyst" | "training";
  placeholder?: string;
  onReady?: (threadId: string) => void;
  /** Open this exact conversation instead of looking one up by title. */
  threadId?: string;
  /** Analyst only: short answers. */
  brief?: boolean;
  /** Auto-run override from a page with its own switch; otherwise the saved 'coach-auto'. */
  auto?: boolean;
  /** An empty thread shows this line, with starters that fill the box (they don't send). */
  empty?: { text: string; starters: string[] };
  /** Sent once, as soon as the thread is ready (the home page's quick box). */
  draft?: { text: string; image: string | null } | null;
  /** After every send settles: the thread's title and order may have changed. */
  onSent?: () => void;
}

const CHIP = "min-h-11 rounded-full border border-border bg-muted/30 px-4 text-sm hover:bg-accent";

/**
 * The one chat every agent page uses (coach included): a grid frame, messages over composer,
 * inside the page's agent-page box, which sizes itself from the visible viewport so the
 * composer sits right on the keyboard.
 */
export function SessionAgent({ hasActive = false, onChanged, title, greeting, quick: quickProp, mode, placeholder, onReady, threadId, brief, auto: autoProp, empty, draft, onSent }: AgentChatProps) {
  useChatScrollLock();
  // The day's title waits for his zone, so a guessed day never opens a second thread.
  const settings = useQuery({ ...settingsQuery, enabled: !title && !threadId });
  const threadTitle = title ?? (settings.isFetched ? todayTitle(settings.data?.timezone) : null);
  const qc = useQueryClient();
  const send = useServerFn(coachReply);
  const transcribe = useServerFn(transcribeAudio);
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A double tap lands before the re-render that disables the button.
  const sending = useRef(false);
  // What he just sent, shown until his row is saved; `from` = rows before it, so an older
  // message with the same words can't hide it.
  const [pending, setPending] = useState<{ text: string; from: number } | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [savedAuto, setSavedAuto] = useState(true);
  const auto = autoProp ?? savedAuto;
  const [zoom, setZoom] = useState<LightboxImage | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const boot = useRef(false);
  // Full image of the last send, kept so "retry" can resend it.
  const lastImage = useRef<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Pages pass inline callbacks; refs keep the memoized rows from re-rendering on every keystroke.
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const onSentRef = useRef(onSent);
  onSentRef.current = onSent;

  // Scrolling: the list scrolls itself (scrollIntoView also dragged the locked page on iOS).
  // `pinned` = he is at the bottom; only then do new rows and growing images pull it down.
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const seen = useRef(0);
  const [newBelow, setNewBelow] = useState(false);

  useEffect(() => { if (localStorage.getItem("coach-auto") === "off") setSavedAuto(false); }, []);

  // Find (or create once) today's session thread, opened by the agent's question.
  const thread = useQuery({
    queryKey: ["session-thread", threadTitle],
    enabled: !threadId && !!threadTitle,
    queryFn: async () => {
      const { data, error } = await supabase.from("coach_threads").select("id").eq("title", threadTitle!).order("created_at").limit(1);
      if (error) throw error;
      return data[0]?.id ?? null;
    },
  });

  useEffect(() => {
    if (threadId || !threadTitle || thread.isLoading || thread.data || boot.current) return;
    boot.current = true;
    (async () => {
      const user_id = await currentUserId();
      const { data, error } = await supabase.from("coach_threads").insert({ user_id, title: threadTitle }).select("id").single();
      if (error) { toast.error("ما قدرت أجهز محادثة الجلسة"); return; }
      const content = greeting ?? (hasActive ? "هلا هادي جلستك شغالة. احكيلي عن أي صفقة أو ارفع صورتها، ولما تخلص قل لي \"خلصت\" وأسوي معك المراجعة." : GREETING_START);
      await supabase.from("coach_messages").insert({ user_id, thread_id: data.id, role: "assistant", content });
      await qc.invalidateQueries({ queryKey: ["session-thread"] });
    })();
  }, [threadId, thread.isLoading, thread.data, hasActive, qc, threadTitle, greeting]);

  const id = threadId ?? thread.data ?? null;
  useEffect(() => { if (id) onReady?.(id); }, [id, onReady]);
  const msgs = useQuery({
    queryKey: ["messages", id],
    enabled: !!id,
    // Agent messages written elsewhere (morning note, watcher alerts) appear without a reload.
    refetchInterval: busy ? false : 15_000,
    queryFn: async (): Promise<ChatMessage[]> => {
      const { data, error } = await supabase.from("coach_messages").select("id,role,content,actions,image,created_at").eq("thread_id", id!).order("created_at");
      if (error) throw error;
      return data;
    },
  });

  async function submit(opts: { text?: string; image?: string | null; again?: boolean } = {}) {
    const again = !!opts.again;
    const img = again ? lastImage.current : opts.image !== undefined ? opts.image : image;
    const msg = (opts.text ?? text).trim() || (img ? "شوف هذي الصورة" : "");
    if (!msg || sending.current || !id) return;
    sending.current = true;
    setBusy(true);
    lastImage.current = img;
    rememberChatImage(img);
    // His own message always brings the view back down to it.
    pinned.current = true;
    setNewBelow(false);
    if (!again) {
      // A chip or a voice note leaves what he was typing in the box.
      if (opts.text === undefined) setText("");
      if (img && img === image) setImage(null);
      setPending({ text: msg, from: msgs.data?.length ?? 0 });
    }
    try {
      const thumb = img ? await makeThumbnail(img) : null;
      const out = await sendReliably(
        (retry) => send({ data: { threadId: id, message: msg, ...(img ? { image: img } : {}), ...(thumb ? { thumb } : {}), ...(retry || again ? { retry: true } : {}), ...(mode ? { mode } : {}), ...(brief != null ? { brief } : {}) } }),
        () => threadState(id, msg),
      );
      if (out.kind === "reply" && out.value?.messageId) setFreshId(out.value.messageId);
      if (out.kind === "pending") toast.error("الرد تأخر. اضغط «أعد المحاولة».");
      await qc.invalidateQueries({ queryKey: ["messages", id] });
    } catch (e) {
      await qc.invalidateQueries({ queryKey: ["messages", id] });
      const rows = [...(qc.getQueryData<{ role: string; content: string }[]>(["messages", id]) ?? [])].reverse();
      const state = retryDecision(rows, msg);
      // The reply did arrive (only the response was lost): nothing to complain about.
      if (state !== "already-answered") toast.error(friendlyError(e));
      // If the message never reached the server, give it back so nothing typed is lost.
      if (!again && state === "fresh") {
        setText((cur) => (opts.text === undefined || !cur.trim() ? msg : cur));
        if (img) setImage(img);
      }
    } finally {
      sending.current = false;
      setBusy(false);
      setPending(null);
      onSentRef.current?.();
    }
  }
  // The recorder's onstop and the draft effect run after later renders: always the newest submit.
  const submitRef = useRef(submit);
  submitRef.current = submit;

  // The home page's message: sent once, as soon as this thread can take it.
  const draftSent = useRef(false);
  useEffect(() => {
    if (!draft || !id || draftSent.current) return;
    draftSent.current = true;
    void submitRef.current({ text: draft.text, image: draft.image });
  }, [draft, id]);

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
        setBusy(true); setPending({ text: "رسالة صوتية…", from: Number.MAX_SAFE_INTEGER });
        try {
          const { text: heard } = await transcribe({ data: { audio: await blobToBase64(blob), mime: blob.type || "audio/webm" } });
          setBusy(false); setPending(null);
          await submitRef.current({ text: heard });
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

  const saveActions = useCallback(async (mid: string, next: StoredAction[]) => {
    await supabase.from("coach_messages").update({ actions: next as never }).eq("id", mid);
    onChangedRef.current?.();
  }, []);

  const list = msgs.data ?? [];
  const showPending = !!pending && !list.slice(pending.from).some((m) => m.role === "user" && retryText(m.content) === pending.text);
  const stuck = !busy ? unansweredMessage(list) : null;
  const quick = quickProp ?? (hasActive ? ["خلصت، سكّر الجلسة", "أبي أدخل صفقة"] : ["إي بتداول اليوم", "لا، ما بتداول اليوم"]);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    pinned.current = shouldAutoScroll(el);
    if (pinned.current) setNewBelow(false);
  }, []);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (pinned.current) el.scrollTop = el.scrollHeight;
    else if (hasNewBelow(seen.current, list.length, false)) setNewBelow(true);
    seen.current = list.length;
  }, [list.length, showPending, busy, stuck]);
  useEffect(() => {
    const el = listRef.current;
    const content = contentRef.current;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    // Images, action cards and the keyboard change heights without adding a row.
    const ro = new ResizeObserver(() => { if (pinned.current) el.scrollTop = el.scrollHeight; });
    ro.observe(el);
    ro.observe(content);
    return () => ro.disconnect();
  }, []);
  function jumpDown() {
    const el = listRef.current;
    pinned.current = true;
    setNewBelow(false);
    if (!el) return;
    if (typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else el.scrollTop = el.scrollHeight;
  }

  return (
    <div className="-mx-4 -mb-2 grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] overflow-hidden lg:panel lg:mx-0 lg:mb-0">
      <div className="relative min-h-0">
        <div ref={listRef} onScroll={onScroll} className="h-full overflow-y-auto overscroll-contain px-4 py-4">
          <div ref={contentRef} className="space-y-4">
            {empty && msgs.isSuccess && list.length === 0 && !showPending && (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <p className="text-sm text-muted-foreground">{empty.text}</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {empty.starters.map((s) => (
                    <button key={s} type="button" onClick={() => { setText(s); taRef.current?.focus(); }} className={CHIP}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {list.map((m) => (
              <MessageRow key={m.id} m={m} autoRun={auto && m.id === freshId} onActions={saveActions} onOpenImage={setZoom} />
            ))}
            {showPending && <UserBubble>{pending.text}</UserBubble>}
            {busy && <TypingBubble />}
            {stuck && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>ما وصل الرد على رسالتك.</span>
                <button type="button" onClick={() => submit({ text: retryText(stuck.content), again: true })} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-muted/30 px-4 text-sm text-foreground hover:bg-accent"><RotateCw className="size-3.5" /> أعد المحاولة</button>
              </div>
            )}
            {!busy && list.length > 0 && quick.length > 0 && (quickProp ? true : list.length < 4) && (
              <div className="flex flex-wrap gap-2">
                {quick.map((q) => (
                  <button key={q} type="button" onClick={() => submit({ text: q })} className={CHIP}>{q}</button>
                ))}
              </div>
            )}
          </div>
        </div>
        {newBelow && (
          <button type="button" onClick={jumpDown} className="glass-strong absolute inset-x-0 bottom-3 mx-auto flex min-h-11 w-fit items-center rounded-full px-4 text-sm font-medium active:scale-95">
            جديد ↓
          </button>
        )}
      </div>

      <ChatComposer
        text={text}
        onText={setText}
        image={image}
        onImage={setImage}
        busy={busy}
        recording={recording}
        placeholder={placeholder ?? "رد على المساعد…"}
        onSend={() => void submit()}
        onToggleRecord={() => void toggleRecord()}
        taRef={taRef}
      />
      <ImageLightbox image={zoom} onClose={() => setZoom(null)} />
    </div>
  );
}
