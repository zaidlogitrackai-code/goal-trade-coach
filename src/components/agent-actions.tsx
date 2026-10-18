import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ACTION_LABEL,
  actionIssue,
  DESTRUCTIVE,
  NeedsConfirmation,
  AlreadySaved,
  parseAction,
  runAction,
  type AgentAction,
} from "@/lib/agent-actions";

export type StoredAction = AgentAction & {
  status?: "done" | "rejected" | "failed" | undefined;
  /** Why it failed, or why it is waiting for a click in auto mode. */
  note?: string | undefined;
};

// Guards against running the same message's actions twice (remounts, StrictMode).
const autoRan = new Set<string>();

/**
 * Cards for AI actions. With `autoRunKey`, safe actions run immediately; deletions
 * and anything that loosens a risk limit stay as approve/reject buttons.
 */
export function AgentActions({
  actions,
  onChange,
  autoRunKey,
}: {
  actions: StoredAction[];
  onChange?: (next: StoredAction[]) => void | Promise<void>;
  autoRunKey?: string;
}) {
  const qc = useQueryClient();
  const [list, setList] = useState<StoredAction[]>(actions);
  const [busy, setBusy] = useState(false);
  const listRef = useRef(list);
  listRef.current = list;

  async function set(next: StoredAction[]) {
    setList(next);
    await onChange?.(next);
  }

  async function run(idxs: number[], auto: boolean) {
    setBusy(true);
    const next = [...listRef.current];
    let ok = 0;
    for (const i of idxs) {
      const a = next[i]!;
      try {
        await runAction(a, { auto });
        next[i] = { ...a, status: "done", note: undefined };
        ok++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "فشل";
        if (e instanceof AlreadySaved) next[i] = { ...a, status: "done", note: msg };
        else if (e instanceof NeedsConfirmation) next[i] = { ...a, status: undefined, note: msg };
        else {
          next[i] = { ...a, status: "failed", note: msg };
          if (!auto) toast.error(`${a.summary}: ${msg}`);
        }
      }
    }
    await qc.invalidateQueries();
    await set(next);
    if (ok) toast.success(auto ? `نفّذت ${ok} إجراء` : `تم تنفيذ ${ok} إجراء`);
    setBusy(false);
  }

  useEffect(() => {
    if (!autoRunKey || autoRan.has(autoRunKey)) return;
    autoRan.add(autoRunKey);
    const idxs = listRef.current
      .map((a, i) => (!a.status && parseAction(a) && !DESTRUCTIVE.includes(a.type) ? i : -1))
      .filter((i) => i >= 0);
    if (idxs.length) void run(idxs, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunKey]);

  const pending = list.map((a, i) => (!a.status && parseAction(a) ? i : -1)).filter((i) => i >= 0);
  if (list.length === 0) return null;
  const allDone = list.every((a) => a.status === "done");
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-border bg-background/60 p-3">
      <p className="text-xs font-medium text-muted-foreground">
        {allDone ? "تم التنفيذ" : pending.length ? "إجراءات تحتاج موافقتك" : "الإجراءات"}
      </p>
      {list.map((a, i) => {
        const valid = !!parseAction(a);
        const danger = DESTRUCTIVE.includes(a.type);
        return (
          <div key={i} className="space-y-1 rounded-lg bg-card p-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded px-2 py-0.5 text-xs ${danger ? "bg-destructive/15 text-destructive" : "bg-secondary"}`}
              >
                {ACTION_LABEL[a.type] ?? a.type}
              </span>
              <span className="min-w-[10rem] flex-1">{a.summary}</span>
              {a.status === "done" ? (
                <span className="flex items-center gap-1 text-xs text-success">
                  <Check className="size-3" /> تم
                </span>
              ) : a.status === "rejected" ? (
                <span className="text-xs text-muted-foreground">مرفوض</span>
              ) : !valid ? (
                <span className="text-xs text-destructive">{actionIssue(a) ?? "بيانات ناقصة"}</span>
              ) : (
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant={danger ? "destructive" : "default"}
                    disabled={busy}
                    onClick={() => run([i], false)}
                  >
                    {a.status === "failed" ? "إعادة المحاولة" : danger ? "احذف" : "موافق"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    aria-label="رفض"
                    onClick={() =>
                      set(list.map((x, j) => (j === i ? { ...x, status: "rejected" } : x)))
                    }
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              )}
            </div>
            {a.note && (
              <p
                className={`flex items-start gap-1 text-xs ${a.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}
              >
                <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {a.note}
              </p>
            )}
          </div>
        );
      })}
      {pending.length > 1 && (
        <Button size="sm" className="w-full" disabled={busy} onClick={() => run(pending, false)}>
          {busy ? "جارٍ التنفيذ…" : `وافق على الكل (${pending.length})`}
        </Button>
      )}
    </div>
  );
}
