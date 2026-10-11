import { describe, expect, it } from "vitest";
import { matchOpen, toForm, type AiTrade } from "./ai-trade";
const base: AiTrade = { action: "open", symbol: "xau/usd", direction: "short", entry: 2350, sl: 2360, tp: null, size: null, risk: 50, exit_price: null, pnl: null, strategy: "بريك", emotion: "سعيد", notes: null };
describe("ai trade mapping", () => {
  it("normalizes symbol, keeps unknown numbers empty, ignores unknown emotion", () => {
    const f = toForm(base, [{ id: "s1", name: "بريك" }]);
    expect(f).toMatchObject({ symbol: "XAUUSD", direction: "short", entry: "2350", tp: "", risk: "50", strategy_id: "s1", emotion: "" });
  });
  it("matches the open trade by symbol for close", () => {
    const trades = [{ id: "a", symbol: "XAUUSD", status: "closed", direction: "short" }, { id: "b", symbol: "XAUUSD", status: "open", direction: "short" }];
    expect(matchOpen({ ...base, action: "close" }, trades)?.id).toBe("b");
  });
});
