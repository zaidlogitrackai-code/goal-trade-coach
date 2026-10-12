import { describe, expect, it } from "vitest";
import { parseTradeCard, splitTradeBlock } from "./trade-card";

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
