import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { toast } from "sonner";
import { Camera, ImagePlus, Loader2, Mic, Plus, SendHorizontal, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import { enterSends, pastedImage } from "@/lib/chat-ui";
import { prepareImage } from "@/lib/image";

export interface ChatComposerProps {
  text: string;
  onText: (text: string) => void;
  image: string | null;
  onImage: (image: string | null) => void;
  busy: boolean;
  recording: boolean;
  placeholder: string;
  onSend: () => void;
  onToggleRecord: () => void;
  taRef: RefObject<HTMLTextAreaElement | null>;
}

const MAX_BOX_PX = 128;

/**
 * The chat input. On the iPhone: Return is a newline (the send button sends), tapping send
 * keeps the keyboard up, and photo / camera / voice live in one '+' sheet so the text box
 * keeps its width. Pasting a screenshot attaches it only here, never in other inputs.
 */
export function ChatComposer({ text, onText, image, onImage, busy, recording, placeholder, onSend, onToggleRecord, taRef }: ChatComposerProps) {
  const coarse = useMediaQuery("(pointer: coarse)");
  const [sheet, setSheet] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  // Whether the box had focus when a composer button was pressed (so the keyboard stays up).
  const hadFocus = useRef(false);

  // Shrink the box back after sending a long message.
  useEffect(() => { if (!text && taRef.current) taRef.current.style.height = ""; }, [text, taRef]);

  async function pick(file?: File | null) {
    if (!file) return;
    setPreparing(true);
    try { onImage(await prepareImage(file)); }
    catch (e) { toast.error(e instanceof Error ? e.message : "ما قدرت أقرأ الصورة"); }
    finally { setPreparing(false); }
  }

  /** Keeps focus in the text box: a tap on send must not drop the keyboard mid-conversation. */
  function keepFocus(e: PointerEvent) {
    hadFocus.current = document.activeElement === taRef.current;
    e.preventDefault();
  }
  function refocus() {
    if (hadFocus.current) taRef.current?.focus({ preventScroll: true });
    hadFocus.current = false;
  }

  /** Runs inside the tap, so iOS allows the file picker / camera / microphone. */
  function choose(run: () => void) {
    run();
    setSheet(false);
  }

  const canSend = !busy && !preparing && (!!text.trim() || !!image);
  const option = "flex min-h-14 w-full items-center gap-3 rounded-2xl border border-border bg-secondary/40 px-4 text-start text-base active:bg-accent";

  return (
    <div className="shrink-0 px-3 pb-1 pt-2 lg:border-t lg:border-border/40 lg:p-3">
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void pick(f); }} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void pick(f); }} />

      {(image || preparing) && (
        <div className="mb-2 flex w-fit items-center gap-2 rounded-2xl border border-border bg-muted/40 p-1">
          {image ? (
            <img src={image} alt="الصورة المرفقة" className="size-11 rounded-xl object-cover" />
          ) : (
            <span className="grid size-11 place-items-center"><Loader2 className="size-4 animate-spin text-muted-foreground" /></span>
          )}
          <span className="text-xs text-muted-foreground">{image ? "صورة مرفقة" : "أجهّز الصورة…"}</span>
          {image && (
            <button type="button" aria-label="حذف الصورة" onClick={() => onImage(null)} className="grid size-11 place-items-center rounded-full text-muted-foreground active:bg-accent">
              <X className="size-4" />
            </button>
          )}
        </div>
      )}

      <div className="flex items-end gap-2">
        <ResponsiveSheet
          open={sheet}
          onOpenChange={setSheet}
          title="أرفق"
          trigger={
            <Button type="button" size="icon" variant="secondary" className="size-11 shrink-0 rounded-full" aria-label="أرفق صورة أو رسالة صوتية" disabled={recording}>
              <Plus className="size-5" />
            </Button>
          }
          className="grid gap-2"
        >
          <button type="button" className={option} onClick={() => choose(() => fileRef.current?.click())}>
            <ImagePlus className="size-5 shrink-0" /> صورة أو لقطة شاشة
          </button>
          <button type="button" className={option} onClick={() => choose(() => camRef.current?.click())}>
            <Camera className="size-5 shrink-0" /> صوّر الشارت بالكاميرا
          </button>
          <button type="button" className={option} onClick={() => choose(onToggleRecord)}>
            <Mic className="size-5 shrink-0" /> رسالة صوتية
          </button>
        </ResponsiveSheet>

        <Textarea
          ref={taRef}
          rows={1}
          value={text}
          enterKeyHint={coarse ? "enter" : "send"}
          onChange={(e) => {
            onText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, MAX_BOX_PX)}px`;
          }}
          onPaste={(e) => {
            const f = pastedImage(e.clipboardData);
            if (!f) return;
            e.preventDefault();
            void pick(f);
          }}
          onKeyDown={(e) => {
            const k = { key: e.key, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode };
            if (enterSends(k, coarse)) { e.preventDefault(); if (canSend) onSend(); }
          }}
          placeholder={recording ? "يسجّل… اضغط ■ للإرسال" : placeholder}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl py-2.5"
        />

        {recording ? (
          <Button type="button" size="icon" variant="destructive" className="size-11 shrink-0 animate-pulse rounded-full" aria-label="إيقاف وإرسال" onClick={onToggleRecord}>
            <Square className="size-4" />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            className="size-11 shrink-0 rounded-full"
            aria-label="إرسال"
            disabled={!canSend}
            onPointerDown={keepFocus}
            onClick={() => { onSend(); refocus(); }}
          >
            <SendHorizontal className="size-4 rotate-180" />
          </Button>
        )}
      </div>
    </div>
  );
}
