import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ACTION_LABEL, parseAction, runAction, type AgentAction } from "@/lib/agent-actions";

export type StoredAction = AgentAction & { status?: "done" | "rejected" };

/** Approve/reject cards for AI-proposed actions. Nothing runs without a click. */
export function AgentActions({ actions, onChange }: { actions: StoredAction[]; onChange?: (next: StoredAction[]) => void | Promise<void> }) {
  const qc = useQueryClient();
  const [list, setList] = useState<StoredAction[]>(actions);
  const [busy, setBusy] = useState(false);

  async function set(next: StoredAction[]) { setList(next); await onChange?.(next); }

  async function approve(idxs: number[]) {
    setBusy(true);
    const next = [...list];
    let ok = 0;
    for (const i of idxs) {
      try { await runAction(next[i]!); next[i] = { ...next[i]!, status: "done" }; ok++; }
      catch (e) { toast.error(`${next[i]!.summary}: ${e instanceof Error ? e.message : "فشل"}`); }
    }
    await qc.invalidateQueries();
    await set(next);
    if (ok) toast.success(`تم تنفيذ ${ok} إجراء`);
    setBusy(false);
  }

  const pending = list.map((a, i) => (!a.status && parseAction(a) ? i : -1)).filter((i) => i >= 0);
  if (list.length === 0) return null;
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-border bg-background/60 p-3">
      <p className="text-xs font-medium text-muted-foreground">إجراءات جاهزة تحتاج موافقتك</p>
      {list.map((a, i) => {
        const valid = !!parseAction(a);
        return (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-card p-2.5 text-sm">
            <span className="rounded bg-secondary px-2 py-0.5 text-xs">{ACTION_LABEL[a.type] ?? a.type}</span>
            <span className="flex-1">{a.summary}</span>
            {a.status === "done" ? <span className="flex items-center gap-1 text-xs text-success"><Check className="size-3" /> تم</span>
              : a.status === "rejected" ? <span className="text-xs text-muted-foreground">مرفوض</span>
              : !valid ? <span className="text-xs text-destructive">بيانات ناقصة</span>
              : (
                <div className="flex gap-1">
                  <Button size="sm" disabled={busy} onClick={() => approve([i])}>موافق</Button>
                  <Button size="sm" variant="secondary" disabled={busy} aria-label="رفض" onClick={() => set(list.map((x, j) => (j === i ? { ...x, status: "rejected" } : x)))}><X className="size-3" /></Button>
                </div>
              )}
          </div>
        );
      })}
      {pending.length > 1 && <Button size="sm" className="w-full" disabled={busy} onClick={() => approve(pending)}>{busy ? "جارٍ التنفيذ…" : `وافق على الكل (${pending.length})`}</Button>}
    </div>
  );
}
