import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, Loading, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { currentUserId, fmtDate, rulesQuery, violationsQuery, type Rule } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/rules")({
  head: () => ({ meta: [{ title: "القواعد — نظام هادي" }, { name: "description", content: "قواعد التداول الشخصية وسجل المخالفات." }] }),
  component: Rules,
});

/**
 * Logging a slip asks first, with an optional note. Cancel logs nothing: window.prompt
 * used to record the violation even when he tapped Cancel.
 */
function ViolationButton({ rule, onLog }: { rule: Rule; onLog: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <ConfirmDialog
      trigger={<Button size="sm" variant="secondary" disabled={!rule.active}>سجّل مخالفة</Button>}
      onOpenChange={(o) => { if (o) setNote(""); }}
      title="تسجّل مخالفة؟"
      description={`القاعدة: ${rule.title}`}
      confirmLabel="سجّل المخالفة"
      onConfirm={() => onLog(note.trim())}
    >
      <div className="space-y-2">
        <Label htmlFor={`violation-note-${rule.id}`}>وش صار؟ (اختياري)</Label>
        <Textarea id={`violation-note-${rule.id}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </ConfirmDialog>
  );
}

function Rules() {
  const r = useQuery(rulesQuery);
  const v = useQuery(violationsQuery);
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  if (r.isLoading) return <Loading />;
  const rules = r.data ?? [];
  const titles = new Map(rules.map((x) => [x.id, x.title]));
  const refresh = () => { qc.invalidateQueries({ queryKey: ["rules"] }); qc.invalidateQueries({ queryKey: ["violations"] }); };

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const { error } = await supabase.from("trading_rules").insert({ title, description: description || null, user_id: await currentUserId() });
    if (error) { toast.error("تعذر الحفظ"); return; }
    setTitle(""); setDescription(""); refresh();
  }
  async function violate(rule_id: string, note: string) {
    const { error } = await supabase.from("rule_violations").insert({ rule_id, note: note || null, user_id: await currentUserId() });
    if (error) { toast.error("تعذر التسجيل"); return; }
    toast.warning("تم تسجيل المخالفة");
    refresh();
  }
  async function update(id: string, active: boolean) {
    const { error } = await supabase.from("trading_rules").update({ active }).eq("id", id);
    if (error) { toast.error("تعذر التحديث"); return; }
    refresh();
  }
  async function remove(id: string) {
    const { error } = await supabase.from("trading_rules").delete().eq("id", id);
    if (error) { toast.error("تعذر الحذف"); return; }
    refresh();
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="القواعد" subtitle="قواعدك الشخصية. أي مخالفة اليوم تغيّر حالة التداول إلى «تجاوز القواعد»." />
      <form onSubmit={add} className="panel mb-6 flex flex-wrap gap-3 p-4">
        <Input className="flex-1 min-w-48" placeholder="مثال: لا أتداول بعد خسارتين" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Input className="flex-1 min-w-48" placeholder="تفاصيل (اختياري)" value={description} onChange={(e) => setDescription(e.target.value)} />
        <Button type="submit">إضافة قاعدة</Button>
      </form>
      {rules.length === 0 ? (
        <EmptyState text="أضف أول قاعدة شخصية تلتزم بها." />
      ) : (
        <div className="space-y-3">
          {rules.map((x) => (
            <div key={x.id} className={`panel flex flex-wrap items-center gap-3 p-4 ${x.active ? "" : "opacity-60"}`}>
              <div className="flex-1">
                <p className="font-medium">{x.title}</p>
                {x.description && <p className="text-sm text-muted-foreground">{x.description}</p>}
              </div>
              <Switch checked={x.active} onCheckedChange={(val) => update(x.id, val)} aria-label="تفعيل" />
              <ViolationButton rule={x} onLog={(note) => void violate(x.id, note)} />
              <ConfirmDialog
                trigger={<Button size="sm" variant="ghost" className="text-destructive">حذف</Button>}
                title="تحذف هذي القاعدة؟"
                description={`«${x.title}» بتنحذف مع كل مخالفاتها المسجلة. لو بدك توقفها بس، طفّي المفتاح جنبها.`}
                confirmLabel="احذف القاعدة"
                destructive
                onConfirm={() => void remove(x.id)}
              />
            </div>
          ))}
        </div>
      )}
      <h2 className="mb-3 mt-10 text-lg font-semibold">سجل المخالفات</h2>
      {(v.data ?? []).length === 0 ? (
        <EmptyState title="لا توجد مخالفات" text="استمر على هذا الانضباط." />
      ) : (
        <div className="space-y-2">
          {v.data!.map((x) => (
            <div key={x.id} className="panel flex justify-between p-3 text-sm">
              <span>{(x.rule_id && titles.get(x.rule_id)) || "قاعدة محذوفة"}{x.note ? ` — ${x.note}` : ""}</span>
              <span className="text-muted-foreground">{fmtDate(x.occurred_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
