import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ImagePlus, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { parseTrade } from "@/lib/ai.functions";
import type { AiTrade } from "@/lib/ai-trade";
import { prepareImage } from "@/lib/image";

export function AiTradeInput({ onResult, placeholder }: { onResult: (t: AiTrade[]) => void; placeholder?: string }) {
  const run = useServerFn(parseTrade);
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function pick(file?: File) {
    if (!file) return;
    setPreparing(true);
    setHint(null);
    try {
      setImage(await prepareImage(file));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ما قدرت أقرأ الصورة");
    } finally {
      setPreparing(false);
    }
  }

  async function go() {
    if (!text.trim() && !image) { toast.error("اكتب وصف الصفقة أو ارفع صورة"); return; }
    setBusy(true);
    setHint(null);
    try {
      const res = await run({ data: { text, ...(image ? { image } : {}) } });
      const list = (res?.trades ?? []) as AiTrade[];
      const message = res?.message?.trim() || null;
      if (list.length === 0) {
        // Keep the image so the user can add the missing numbers as text and retry.
        setHint(message ?? "ما لقيت صفقة واضحة. اكتب الدخول والوقف والهدف، أو ارسم أداة Long/Short Position على الشارت.");
        return;
      }
      onResult(list);
      if (message) toast.info(message);
      setText(""); setImage(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذّر الفهم، حاول مرة ثانية");
    } finally { setBusy(false); }
  }

  return (
    <section className="panel space-y-3 p-5">
      <div className="flex items-center gap-2"><Wand2 className="size-4" /><h2 className="font-semibold">أدخلها بالذكاء الاصطناعي</h2></div>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} onPaste={(e) => void pick(Array.from(e.clipboardData.files)[0])}
        placeholder={placeholder ?? "مثال: اشتريت ذهب على 2350 ستوب 2340 هدف 2380 مخاطرة 50 دولار، كنت هادئ"} />
      {image && (
        <div className="relative w-fit">
          <img src={image} alt="الصورة المرفقة" className="max-h-40 rounded-lg border border-border" />
          <button type="button" aria-label="حذف الصورة" onClick={() => setImage(null)} className="absolute -top-2 -left-2 rounded-full bg-secondary p-1"><X className="size-3" /></button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
        <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()} disabled={preparing}><ImagePlus className="size-4" /> {preparing ? "جارٍ التجهيز…" : "صورة"}</Button>
        <Button type="button" onClick={go} disabled={busy || preparing}>{busy ? "جارٍ القراءة…" : "عبّي لي"}</Button>
      </div>
      {hint && <p role="status" className="rounded-lg border border-warning/40 p-3 text-sm">{hint}</p>}
      <p className="text-xs text-muted-foreground">اكتب الصفقة أو الصق صورتها. للشارت استخدم <Link to="/analyst" className="underline">المحلل</Link>.</p>
    </section>
  );
}
