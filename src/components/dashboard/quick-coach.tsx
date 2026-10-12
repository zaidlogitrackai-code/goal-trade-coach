import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Bot, ImagePlus, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { prepareImage } from "@/lib/image";

export const COACH_DRAFT_KEY = "coach-draft";

/** One box on the home page: type or attach an MT5/chart screenshot, the coach does the rest. */
export function QuickCoach({ needsGoals = false }: { needsGoals?: boolean }) {
  const nav = useNavigate();
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function pick(file?: File) {
    if (!file) return;
    try { setImage(await prepareImage(file)); } catch (e) { toast.error(e instanceof Error ? e.message : "ما قدرت أقرأ الصورة"); }
  }

  function interview() {
    sessionStorage.setItem(COACH_DRAFT_KEY, JSON.stringify({ text: "أنا أبدأ الحين. اسألني عن أهدافي وحدودي والطمع وحطها بالنظام", image: null }));
    void nav({ to: "/coach" });
  }

  function go() {
    const msg = text.trim() || (image ? "سجّل الصفقات اللي بالصورة وحللها" : "");
    if (!msg) return;
    sessionStorage.setItem(COACH_DRAFT_KEY, JSON.stringify({ text: msg, image }));
    void nav({ to: "/coach" });
  }

  return (
    <section className="panel space-y-3 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold"><Bot className="size-4 shrink-0" /> قل لسَنَد وهو ينفّذ</div>
        {needsGoals && (
          <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={interview}>خلّ سَنَد يسألني</Button>
        )}
      </div>
      {needsGoals && (
        <p className="text-xs leading-5 text-muted-foreground">المدرب يحتاج تارقتك وحد خسارتك عشان يوقفك قبل ما تطمع.</p>
      )}
      <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} onPaste={(e) => void pick(Array.from(e.clipboardData.files)[0])}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } }}
        placeholder="اكتب أي شيء، أو ارفع لقطة من MetaTrader 5 ويسجّل صفقاتك" />
      {image && (
        <div className="relative w-fit">
          <img src={image} alt="الصورة المرفقة" className="max-h-24 rounded-lg border border-border" />
          <button type="button" aria-label="حذف الصورة" onClick={() => setImage(null)} className="absolute -top-2 -left-2 rounded-full bg-secondary p-1"><X className="size-3" /></button>
        </div>
      )}
      <div className="flex gap-2">
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
        <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}><ImagePlus className="size-4" /> صورة</Button>
        <Button type="button" className="flex-1" onClick={go} disabled={!text.trim() && !image}><Send className="size-4" /> أرسل</Button>
      </div>
    </section>
  );
}
