import { describe, expect, it } from "vitest";
import { createSafeStorage } from "./safe-storage";

function fakeStorage(opts: { full?: boolean } = {}): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      if (opts.full) throw new DOMException("quota", "QuotaExceededError");
      m.set(k, v);
    },
    removeItem: (k) => { m.delete(k); },
  };
}

describe("safe storage", () => {
  it("reads and writes through to the real storage", () => {
    const real = fakeStorage();
    const s = createSafeStorage(() => real);
    expect(s.set("a", "1")).toBe(true);
    expect(real.getItem("a")).toBe("1");
    expect(s.get("a")).toBe("1");
    s.remove("a");
    expect(s.get("a")).toBeNull();
  });

  it("keeps a refused write in memory instead of throwing", () => {
    const s = createSafeStorage(() => fakeStorage({ full: true }));
    expect(s.set("draft", "big screenshot")).toBe(false);
    expect(s.get("draft")).toBe("big screenshot");
    s.remove("draft");
    expect(s.get("draft")).toBeNull();
  });

  it("survives storage that throws on access (blocked by Safari)", () => {
    const s = createSafeStorage(() => { throw new DOMException("denied", "SecurityError"); });
    expect(s.get("x")).toBeNull();
    expect(s.set("x", "1")).toBe(false);
    expect(s.get("x")).toBe("1");
    expect(() => s.remove("x")).not.toThrow();
  });

  it("works with no storage at all (server render)", () => {
    const s = createSafeStorage(() => null);
    expect(s.get("x")).toBeNull();
    expect(s.set("x", "1")).toBe(false);
  });
});
