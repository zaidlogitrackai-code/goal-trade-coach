import { describe, expect, it } from "vitest";
import { cardHref, cardSizing, cardToSearch, parseTradeCard, splitTradeBlock } from "./trade-card";

describe("trade card", () => {
  it("accepts a valid buy and computes R:R to TP2", () => {
    const r = parseTradeCard(JSON.stringify({ direction: "buy", entry_from: 100, entry_to: 100, sl: 95, tp1: 105, tp2: 110 }));
    expect(r.ok && r.card.rr).toBe(2);
  });
  it("rejects a buy with SL above entry", () => {
    expect(parseTradeCard(JSON.stringify({ direction: "buy", entry_from: 100, sl: 101, tp1: 105 })).ok).toBe(false);
  });
  it("rejects a sell whose TP2 is not beyond TP1", () => {
    expect(parseTradeCard(JSON.stringify({ direction: "sell", entry_from: 100, sl: 105, tp1: 95, tp2: 97 })).ok).toBe(false);
  });
  it("reads trade style and holding time", () => {
    const r = parseTradeCard(JSON.stringify({ direction: "buy", entry_from: 100, sl: 95, tp1: 105, style: "Scalp", hold: "10-30 دقيقة" }));
    expect(r.ok && r.card.style).toBe("scalp");
    expect(r.ok && r.card.hold).toBe("10-30 دقيقة");
    const n = parseTradeCard(JSON.stringify({ direction: "sell", entry_from: 100, sl: 105, tp1: 95, style: "swing" }));
    expect(n.ok && n.card.style).toBe("swing");
  });
  it("accepts no-trade", () => {
    const r = parseTradeCard(JSON.stringify({ direction: "none", no_trade_reason: "انتظر" }));
    expect(r.ok && r.card.direction).toBe("none");
  });
  it("splits the block out of the text", () => {
    const s = splitTradeBlock('تحليل\n```trade\n{"direction":"none"}\n```');
    expect(s.body).toBe("تحليل");
    expect(s.raw).toBe('{"direction":"none"}');
  });
});

describe("trade card — gate hand-off", () => {
  it("accepts a watch idea without full numbers", () => {
    const r = parseTradeCard(JSON.stringify({ intent: "watch", direction: "buy", symbol: "xauusd", entry_from: 2400 }));
    expect(r.ok && r.card.intent).toBe("watch");
    expect(r.ok && r.card.symbol).toBe("XAUUSD");
  });
  it("still rejects a trade with missing numbers", () => {
    expect(parseTradeCard(JSON.stringify({ intent: "trade", direction: "buy", entry_from: 100 })).ok).toBe(false);
  });
  it("drops skills the symbol can't support", () => {
    const fx = parseTradeCard(JSON.stringify({ direction: "buy", symbol: "EURUSD", entry_from: 1.1, sl: 1.09, tp1: 1.12, skills: ["SMC", "Volume Analysis"] }));
    expect(fx.ok && fx.card.skills).toEqual(["SMC"]);
    const gold = parseTradeCard(JSON.stringify({ direction: "buy", symbol: "XAUUSD", entry_from: 100, sl: 95, tp1: 105, skills: ["SMC", "Volume Analysis"] }));
    expect(gold.ok && gold.card.skills).toEqual(["SMC", "Volume Analysis"]);
  });
  it("hands the stepper the mid entry, stop, first target and analysis id", () => {
    const r = parseTradeCard(JSON.stringify({ direction: "sell", symbol: "XAUUSD", entry_from: 2410, entry_to: 2412, sl: 2420, tp1: 2400 }));
    if (!r.ok) throw new Error("bad card");
    expect(cardToSearch(r.card, "a1")).toEqual({ symbol: "XAUUSD", direction: "sell", entry: 2411, sl: 2420, tp: 2400, analysis_id: "a1" });
    expect(cardHref(r.card)).toBe("/new-trade?symbol=XAUUSD&direction=sell&entry=2411&sl=2420&tp=2400");
  });
  it("sizes the lots to his per-trade risk", () => {
    const r = parseTradeCard(JSON.stringify({ direction: "buy", symbol: "XAUUSD", entry_from: 2400, sl: 2395, tp1: 2410 }));
    if (!r.ok) throw new Error("bad card");
    const s = cardSizing(r.card, 100);
    expect(s && s.lots).toBeGreaterThan(0);
    expect(s && s.risk).toBeLessThanOrEqual(100);
    expect(cardSizing(r.card, 0)).toBeNull();
  });
});
