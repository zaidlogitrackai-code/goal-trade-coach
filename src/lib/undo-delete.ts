import { toast } from "sonner";

export const UNDO_MS = 5_000;

// key -> "commit now". Lists skip these rows so a refetch inside the window can't bring them back.
const pending = new Map<string, () => void>();

/** True while `key` waits out its undo window: show it as already deleted. */
export function isPendingDelete(key: string): boolean {
  return pending.has(key);
}

let listening = false;
/** Leaving the app commits at once: an undo window must never turn into a delete that never happened. */
function commitOnLeave() {
  if (listening || typeof document === "undefined") return;
  listening = true;
  const flush = () => [...pending.values()].forEach((commit) => commit());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  window.addEventListener("pagehide", flush);
}

/**
 * Deletes after a short «تراجع» window instead of at once. On the phone one stray tap used to
 * wipe a whole conversation for good; the caller hides the row first, `onUndo` brings it back.
 */
export function deleteWithUndo({ key, message, commit, onUndo, onError, ms = UNDO_MS }: {
  key: string;
  message: string;
  commit: () => Promise<void>;
  onUndo?: () => void;
  onError?: (e: unknown) => void;
  ms?: number;
}): void {
  if (pending.has(key)) return;
  commitOnLeave();
  let settled = false;
  const settle = () => {
    if (settled) return false;
    settled = true;
    clearTimeout(timer);
    pending.delete(key);
    return true;
  };
  const run = () => {
    if (!settle()) return;
    toast.dismiss(id);
    commit().catch((e: unknown) => onError?.(e));
  };
  const timer = setTimeout(run, ms);
  pending.set(key, run);
  const id = toast(message, {
    duration: ms,
    action: { label: "تراجع", onClick: () => { if (settle()) onUndo?.(); } },
  });
}
