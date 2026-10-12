import { describe, expect, it } from "vitest";
import {
  buildInsights,
  deriveSignals,
  EMPTY_FOCUS,
  focusForPrompt,
  inMarkets,
  mergeFocus,
  parseFocus,
  splitMarkets,
  type SignalTrade,
} from "./focus";
import { planNav } from "./nav-plan";

const now = new Date("2026-10-11T12:00:00Z");
const tr = (o: Partial<SignalTrade>): SignalTrade => ({
  symbol: "XAUUSD",
  status: "closed",
  pnl: 0,
  emotion: null,
  strategy_id: null,
  stop_loss: 1,
  opened_at: "2026-10-10T10:00:00Z",
  closed_at: "2026-10-10T10:30:00Z",
  ...o,
});
const money = (n: number) => `${n}$`;

describe("markets", () => {
  it("normalises Arabic names, slashes and separators", () => {
    expect(splitMarkets("ذهب، EUR/USD و nas100 بيتكوين")).toEqual(["XAUUSD", "EURUSD", "US100"]);
    expect(splitMarkets(["gold", "XAUUSD"])).toEqual(["XAUUSD"]);
  });
  it("judges symbols against specific markets only", () => {
    expect(inMarkets("XAU/USD", ["XAUUSD"])).toBe(true);
    expect(inMarkets("EURUSD", ["XAUUSD"])).toBe(false);
    expect(inMarkets("EURUSD", ["EUR"])).toBe(true);
    expect(inMarkets("EURUSD", [])).toBeNull();
    expect(inMarkets("EURUSD", ["فوركس"])).toBeNull();
  });
});

describe("focus profile", () => {
  it("parses junk as empty and keeps valid fields", () => {
    expect(parseFocus("not json")).toEqual(EMPTY_FOCUS);
    expect(parseFocus('{"goal":"صفقتين باليوم","markets":"bad"}')).toMatchObject({
      goal: "صفقتين باليوم",
      markets: [],
    });
  });
  it("merges patches: replaces markets, clears with empty text, appends unique notes", () => {
    let f = mergeFocus(
      EMPTY_FOCUS,
      { markets: "ذهب", weakness: "الطمع بعد الربح", add_note: "بيتداول جلسة لندن" },
      now,
    );
    f = mergeFocus(f, { add_note: "بيتداول جلسة لندن", goal: "" }, now);
    expect(f).toMatchObject({
      markets: ["XAUUSD"],
      weakness: "الطمع بعد الربح",
      goal: null,
      notes: ["بيتداول جلسة لندن"],
    });
    expect(mergeFocus(f, { remove_note: "لندن" }, now).notes).toEqual([]);
    expect(focusForPrompt(f)).toContain("نقطة الضعف: الطمع بعد الربح");
  });
});

describe("signals", () => {
  const focus = { ...EMPTY_FOCUS, markets: ["XAUUSD"] };
  const trades = [
    tr({ pnl: -100, closed_at: "2026-10-10T10:30:00Z" }),
    tr({
      pnl: -50,
      opened_at: "2026-10-10T10:45:00Z",
      closed_at: "2026-10-10T11:00:00Z",
      emotion: "متوتر",
    }),
    tr({
      pnl: -30,
      opened_at: "2026-10-10T11:20:00Z",
      closed_at: "2026-10-10T11:40:00Z",
      emotion: "متوتر",
    }),
    tr({
      symbol: "GBPJPY",
      pnl: -80,
      opened_at: "2026-10-05T10:00:00Z",
      closed_at: "2026-10-05T12:00:00Z",
      stop_loss: null,
    }),
    tr({
      symbol: "XAUUSD",
      pnl: 999,
      opened_at: "2026-08-01T10:00:00Z",
      closed_at: "2026-08-01T11:00:00Z",
    }),
  ];
  const s = deriveSignals(trades, [], focus, now);
  it("ignores trades older than 30 days", () => expect(s.recentCount).toBe(4));
  it("finds the revenge window, worst emotion, outside-market and no-stop trades", () => {
    expect(s.afterLoss).toEqual({ count: 2, pnl: -80 });
    expect(s.worstEmotion).toEqual({ emotion: "متوتر", pnl: -80, count: 2 });
    expect(s.outsideFocus).toEqual({ count: 1, pnl: -80, symbols: ["GBPJPY"] });
    expect(s.noStop).toBe(1);
    expect(s.topSymbols[0]).toEqual({ symbol: "XAUUSD", count: 3 });
  });
  it("puts warnings first and caps the list", () => {
    const ins = buildInsights(s, focus, money);
    expect(ins[0]!.text).toContain("برّا سوقك");
    expect(ins.length).toBeLessThanOrEqual(4);
  });
  it("suggests pinning the top market when none is set", () => {
    const ins = buildInsights(
      deriveSignals([tr({ pnl: 10 })], [], EMPTY_FOCUS, now),
      EMPTY_FOCUS,
      money,
    );
    expect(ins.at(-1)!.text).toContain("XAUUSD");
  });
});

describe("planNav", () => {
  const base = {
    strategies: 2,
    rules: 3,
    trades: 10,
    closed: 8,
    notes: 1,
    activeSession: false,
    violationsWeek: 0,
    blocked: false,
  };
  it("falls back to the static mobile bar while loading", () => {
    expect(planNav(null)).toEqual({
      pinned: [],
      more: [],
      mobile: ["/dashboard", "/session", "/new-trade", "/trades", "/risk"],
    });
  });
  it("puts setup gaps and the session first for a new trader, tucks empty pages away", () => {
    const p = planNav({ ...base, strategies: 0, rules: 0, trades: 0, closed: 0, notes: 0 });
    expect(p.pinned).toEqual(["/session", "/strategies", "/rules", "/coach"]);
    expect(p.more).toEqual(["/trades", "/discipline", "/performance", "/reports", "/knowledge"]);
    expect(p.mobile[0]).toBe("/dashboard");
    expect(p.mobile).toHaveLength(5);
  });
  it("leads with the new trade during a session, and with review when blocked", () => {
    expect(planNav({ ...base, activeSession: true }).pinned.slice(0, 2)).toEqual([
      "/new-trade",
      "/session",
    ]);
    expect(planNav({ ...base, blocked: true, violationsWeek: 2 }).pinned.slice(0, 2)).toEqual([
      "/discipline",
      "/coach",
    ]);
  });
});
