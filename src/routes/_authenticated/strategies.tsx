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
import { Switch } from "@/components/ui/switch";
import { currentUserId, strategiesQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/strategies")({
  head: () => ({ meta: [{ title: "استراتيجياتي — نظام هادي" }, { name: "description", content: "استراتيجيات التداول وشروطها." }] }),
  component: Strategies,
});

const EMPTY = { name: "", description: "", entry_conditions: "", exit_conditions: "", markets: "", timeframes: "" };

function Strategies() {
  const { data, isLoading } = useQuery(strategiesQuery);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(EMPTY);
  if (isLoading) return <Loading />;
  const refresh = () => qc.invalidateQueries({ queryKey: ["strategies"] });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) { toast.error("أدخل اسم الاستراتيجية"); return; }
    const { error } = await supabase.from("strategies").insert({ ...f, user_id: await currentUserId() });
    if (error) { toast.error("تعذر الحفظ"); return; }
    setF(EMPTY); setOpen(false); refresh(); toast.success("تمت إضافة الاستراتيجية");
  }
  async function toggle(id: string, allowed: boolean) {
    const { error } = await supabase.from("strategies").update({ allowed }).eq("id", id);
    if (error) { toast.error("تعذر التحديث"); return; }
    refresh();
  }
  async function remove(id: string) {
    if (!confirm("حذف هذه الاستراتيجية؟")) return;
    const { error } = await supabase.from("strategies").delete().eq("id", id);
    if (error) { toast.error("تعذر الحذف"); return; }
    refresh();
  }
  const field = (k: keyof typeof EMPTY, label: string, area = false) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      {area ? <Textarea value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /> : <Input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="استراتيجياتي" subtitle="الاستراتيجيات المسموحة فقط تظهر عند تسجيل صفقة." action={<Button onClick={() => setOpen(!open)}>{open ? "إلغاء" : "استراتيجية جديدة"}</Button>} />
      {open && (
        <form onSubmit={add} className="panel mb-6 grid gap-4 p-5 sm:grid-cols-2">
          {field("name", "الاسم")}
          {field("markets", "الأسواق")}
          {field("timeframes", "الفريمات")}
          {field("description", "الوصف")}
          <div className="sm:col-span-2">{field("entry_conditions", "شروط الدخول", true)}</div>
          <div className="sm:col-span-2">{field("exit_conditions", "شروط الخروج", true)}</div>
          <Button type="submit" className="sm:col-span-2">حفظ</Button>
        </form>
      )}
      {(data ?? []).length === 0 ? (
        !open && <EmptyState text="أضف أول استراتيجية لك لتربطها بصفقاتك." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data!.map((x) => (
            <div key={x.id} className="panel space-y-3 p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{x.name}</h3>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  {x.allowed ? "مسموحة" : "موقوفة"}
                  <Switch checked={x.allowed} onCheckedChange={(v) => toggle(x.id, v)} />
                </label>
              </div>
              {x.description && <p className="text-sm text-muted-foreground">{x.description}</p>}
              {(x.markets || x.timeframes) && <p className="text-xs text-muted-foreground" dir="auto">{[x.markets, x.timeframes].filter(Boolean).join(" · ")}</p>}
              {x.entry_conditions && <div><p className="text-xs text-primary">الدخول</p><p className="whitespace-pre-wrap text-sm">{x.entry_conditions}</p></div>}
              {x.exit_conditions && <div><p className="text-xs text-primary">الخروج</p><p className="whitespace-pre-wrap text-sm">{x.exit_conditions}</p></div>}
              <button onClick={() => remove(x.id)} className="text-xs text-destructive">حذف</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
