import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ImagePlus, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { parseTrade } from "@/lib/ai.functions";
import type { AiTrade } from "@/lib/ai-trade";

export function AiTradeInput({ onResult, placeholder }: { onResult: (t: AiTrade[]) => void; placeholder?: string }) {
  const run = useServerFn(parseTrade);
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function pick(file?: File) {
    if (!file) return;
    if (file.size > 5_000_000) { toast.error("الصورة أكبر من 5MB"); return; }
    const r = new FileReader();
    r.onload = () => setImage(String(r.result));
    r.readAsDataURL(file);
  }

  async function go() {
    if (!text.trim() && !image) { toast.error("اكتب وصف الصفقة أو ارفع صورة"); return; }
    setBusy(true);
    try {
      const res = await run({ data: { text, ...(image ? { image } : {}) } });
      const list = (res?.trades ?? []) as AiTrade[];
      if (list.length === 0) { toast.error("ما لقيت صفقة واضحة، وضّح أكثر"); return; }
      onResult(list);
      setText(""); setImage(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذّر الفهم، حاول مرة ثانية");
    } finally { setBusy(false); }
  }

  return (
    <section className="panel space-y-3 p-5">
      <div className="flex items-center gap-2"><Wand2 className="size-4" /><h2 className="font-semibold">أدخلها بالذكاء الاصطناعي</h2></div>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} onPaste={(e) => pick(Array.from(e.clipboardData.files)[0])}
        placeholder={placeholder ?? "مثال: اشتريت ذهب على 2350 ستوب 2340 هدف 2380 مخاطرة 50 دولار، كنت هادئ"} />
      {image && (
        <div className="relative w-fit">
          <img src={image} alt="الصورة المرفقة" className="max-h-40 rounded-lg border border-border" />
          <button type="button" aria-label="حذف الصورة" onClick={() => setImage(null)} className="absolute -top-2 -left-2 rounded-full bg-secondary p-1"><X className="size-3" /></button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}><ImagePlus className="size-4" /> صورة</Button>
        <Button type="button" onClick={go} disabled={busy}>{busy ? "جارٍ الفهم…" : "عبّي لي"}</Button>
      </div>
      <p className="text-xs text-muted-foreground">تقدر تكتب، أو تلصق/ترفع لقطة من المنصة. بتراجع البيانات قبل الحفظ.</p>
    </section>
  );
}
