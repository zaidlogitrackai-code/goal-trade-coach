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
    expect(s.afterLoss).toEqual({ count: 2, pnl: -80, minutes: 30 });
    expect(s.worstEmotion).toEqual({ emotion: "متوتر", pnl: -80, count: 2 });
    expect(s.outsideFocus).toEqual({ count: 1, pnl: -80, symbols: ["GBPJPY"] });
    expect(s.noStop).toBe(1);
    expect(s.topSymbols[0]).toEqual({ symbol: "XAUUSD", count: 3 });
  });
  it("uses the shared revenge window, stretched by a longer cooldown", () => {
    const late = [
      tr({ pnl: -100, closed_at: "2026-10-10T10:30:00Z" }),
      tr({ pnl: -20, opened_at: "2026-10-10T11:10:00Z", closed_at: "2026-10-10T11:12:00Z" }),
      tr({ pnl: -20, opened_at: "2026-10-10T11:50:00Z", closed_at: "2026-10-10T11:52:00Z" }),
    ];
    expect(deriveSignals(late, [], focus, now).afterLoss).toBeNull();
    const wide = deriveSignals(late, [], focus, now, 60);
    expect(wide.afterLoss).toEqual({ count: 2, pnl: -40, minutes: 60 });
    expect(buildInsights(wide, focus, money).map((i) => i.text).join(" ")).toContain(
      "خلال 60 دقيقة بعد خسارة",
    );
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
