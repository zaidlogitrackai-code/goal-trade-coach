import { describe, expect, it } from "vitest";
import {
  applyMove,
  capitalForPrompt,
  computeCapital,
  parseLedger,
  removeEntry,
  type CapitalTrade,
  type Ledger,
} from "./capital";

const trades: CapitalTrade[] = [
  {
    status: "closed",
    pnl: 150,
    opened_at: "2026-10-02T09:00:00Z",
    closed_at: "2026-10-02T10:00:00Z",
  },
  {
    status: "closed",
    pnl: -60,
    opened_at: "2026-10-03T09:00:00Z",
    closed_at: "2026-10-03T10:00:00Z",
  },
  { status: "open", pnl: null, opened_at: "2026-10-04T09:00:00Z", closed_at: null },
  // Closed before onboarding: already inside starting_balance.
  {
    status: "closed",
    pnl: 999,
    opened_at: "2026-09-01T09:00:00Z",
    closed_at: "2026-09-01T10:00:00Z",
  },
];
const base = { starting: 1000, since: "2026-10-01T00:00:00Z", trades };

describe("capital", () => {
  it("moves the balance with closed trades only", () => {
    const s = computeCapital({ ...base, entries: [] });
    expect(s.tradePnl).toBe(90);
    expect(s.balance).toBe(1090);
    expect(s.growthPct).toBe(9);
  });

  it("deposit, withdrawal and set_balance, with growth separated from money moved", () => {
    const now = new Date("2026-10-05T12:00:00Z");
    let l: Ledger = parseLedger(null);
    const d = applyMove(l, { kind: "deposit", amount: 500 }, 1090, now, "a");
    expect(d.balance).toBe(1590);
    l = d.ledger;
    const w = applyMove(l, { kind: "withdrawal", amount: 200, note: "أرباح" }, 1590, now, "b");
    expect(w.balance).toBe(1390);
    l = w.ledger;
    const s = computeCapital({ ...base, entries: l.entries });
    expect(s).toMatchObject({
      balance: 1390,
      deposits: 500,
      withdrawals: 200,
      netInvested: 1300,
      growth: 90,
    });

    const fix = applyMove(l, { kind: "set_balance", amount: 1350 }, s.balance, now, "c");
    expect(fix.entry).toMatchObject({ kind: "adjust", amount: -40 });
    expect(computeCapital({ ...base, entries: fix.ledger.entries }).balance).toBe(1350);

    expect(computeCapital({ ...base, entries: removeEntry(fix.ledger, "b").entries }).balance).toBe(
      1550,
    );
    expect(capitalForPrompt(s, l.entries, "USD")).toContain("الرصيد الحالي 1390 USD");
  });

  it("rejects bad amounts and over-withdrawal", () => {
    const l = parseLedger("");
    expect(() => applyMove(l, { kind: "deposit", amount: 0 }, 100)).toThrow();
    expect(() => applyMove(l, { kind: "deposit", amount: Number.NaN }, 100)).toThrow();
    expect(() => applyMove(l, { kind: "withdrawal", amount: 101 }, 100)).toThrow(/أكبر من رصيدك/);
    expect(() => applyMove(l, { kind: "set_balance", amount: 100 }, 100)).toThrow();
    expect(applyMove(l, { kind: "set_balance", amount: 0 }, 100).balance).toBe(0);
  });

  it("survives corrupt storage", () => {
    expect(parseLedger("{oops").entries).toEqual([]);
    expect(
      parseLedger(JSON.stringify({ entries: [{ id: "x", kind: "steal", amount: 5, at: "" }] }))
        .entries,
    ).toEqual([]);
  });

  it("reports what it could not read instead of hiding it", () => {
    expect(parseLedger(null)).toEqual({ entries: [], dropped: [], corrupt: false });
    expect(parseLedger("{oops")).toMatchObject({ entries: [], corrupt: true });
    expect(parseLedger("{}").corrupt).toBe(true);
    const ok = { id: "a", kind: "deposit", amount: 100, note: null, at: "2026-10-02T09:00:00Z" };
    const bad = { id: "b", kind: "deposit", amount: "lots", at: "2026-10-05T09:00:00Z" };
    const p = parseLedger(JSON.stringify({ entries: [ok, bad, 7] }));
    expect(p.entries.map((e) => e.id)).toEqual(["a"]);
    expect(p.dropped).toEqual([{ id: "b", at: "2026-10-05T09:00:00Z" }, { id: null, at: null }]);
    expect(p.corrupt).toBe(false);
  });
});
