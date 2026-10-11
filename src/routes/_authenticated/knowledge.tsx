import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, Loading, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { currentUserId, fmtDate } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/knowledge")({
  head: () => ({ meta: [{ title: "مركز المعرفة — نظام هادي" }, { name: "description", content: "دروسك وملاحظاتك وأخطاؤك في مكان واحد." }] }),
  component: KnowledgePage,
});

const CATS = ["عام", "دروس", "أخطاء", "استراتيجيات", "نفسية", "أخبار السوق"];
const empty = { id: "", title: "", category: "عام", content: "" };

function KnowledgePage() {
  const qc = useQueryClient();
  const [f, setF] = useState(empty);
  const [cat, setCat] = useState("الكل");
  const [q, setQ] = useState("");
  const n = useQuery({
    queryKey: ["notes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("knowledge_notes").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.title.trim()) { toast.error("اكتب عنوان"); return; }
    const user_id = await currentUserId();
    const row = { title: f.title.trim(), category: f.category, content: f.content };
    const { error } = f.id ? await supabase.from("knowledge_notes").update(row).eq("id", f.id) : await supabase.from("knowledge_notes").insert({ ...row, user_id });
    if (error) { toast.error("ما قدرت أحفظ"); return; }
    toast.success("تم الحفظ"); setF(empty);
    qc.invalidateQueries({ queryKey: ["notes"] });
  }
  async function del(id: string) {
    const { error } = await supabase.from("knowledge_notes").delete().eq("id", id);
    if (error) { toast.error("ما قدرت أحذف"); return; }
    qc.invalidateQueries({ queryKey: ["notes"] });
  }

  if (n.isLoading) return <Loading />;
  const rows = (n.data ?? []).filter((x) => (cat === "الكل" || x.category === cat) && (!q || (x.title + x.content).includes(q)));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="مركز المعرفة" subtitle="ابنِ مكتبتك: دروسك، أخطاؤك، وملاحظاتك." />
      <form onSubmit={save} className="panel space-y-3 p-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
          <div className="space-y-2"><Label>العنوان</Label><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div className="space-y-2"><Label>التصنيف</Label>
            <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select>
          </div>
        </div>
        <div className="space-y-2"><Label>المحتوى</Label><Textarea rows={5} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} /></div>
        <div className="flex gap-2"><Button type="submit">{f.id ? "حفظ التعديل" : "إضافة"}</Button>{f.id && <Button type="button" variant="ghost" onClick={() => setF(empty)}>إلغاء</Button>}</div>
      </form>
      <div className="flex flex-wrap gap-2">
        {["الكل", ...CATS].map((c) => <Button key={c} size="sm" variant={cat === c ? "default" : "secondary"} onClick={() => setCat(c)}>{c}</Button>)}
        <Input className="max-w-56" placeholder="بحث" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {rows.length === 0 ? <EmptyState text="أضف أول ملاحظة أو درس." /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((x) => (
            <div key={x.id} className="panel p-4">
              <div className="flex items-start justify-between gap-2">
                <div><p className="font-semibold">{x.title}</p><p className="text-xs text-muted-foreground">{x.category} · {fmtDate(x.created_at)}</p></div>
                <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setF({ id: x.id, title: x.title, category: x.category, content: x.content })}>تعديل</Button><Button size="sm" variant="ghost" onClick={() => del(x.id)}>حذف</Button></div>
              </div>
              {x.content && <p className="mt-3 whitespace-pre-wrap text-sm text-secondary-foreground">{x.content}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
