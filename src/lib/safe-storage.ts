/**
 * localStorage / sessionStorage that never throws. Safari throws on a full quota (a chart
 * screenshot handed to the coach) and when storage is blocked; a throw there used to drop
 * the message or break the page. A refused write is kept in memory for this page's life,
 * so a hand-off between two screens still arrives.
 */
export interface SafeStorage {
  get(key: string): string | null;
  /** False when the browser refused it (kept in memory only, gone after a reload). */
  set(key: string, value: string): boolean;
  remove(key: string): void;
}

export function createSafeStorage(store: () => Storage | null | undefined): SafeStorage {
  const memory = new Map<string, string>();
  const real = () => {
    try {
      return store() ?? null;
    } catch {
      return null;
    }
  };
  return {
    get(key) {
      if (memory.has(key)) return memory.get(key)!;
      try {
        return real()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        const s = real();
        if (!s) throw new Error("no storage");
        s.setItem(key, value);
        memory.delete(key);
        return true;
      } catch {
        memory.set(key, value);
        return false;
      }
    },
    remove(key) {
      memory.delete(key);
      try {
        real()?.removeItem(key);
      } catch {
        /* blocked storage: nothing stored there either */
      }
    },
  };
}

const browser = typeof window !== "undefined";
export const safeLocal = createSafeStorage(() => (browser ? window.localStorage : null));
export const safeSession = createSafeStorage(() => (browser ? window.sessionStorage : null));
