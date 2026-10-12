import { describe, expect, it } from "vitest";
import { findDuplicate, type DedupeRow } from "./trade-dedupe";

const row: DedupeRow = { id: "1", symbol: "XAUUSD", direction: "long", entry_price: 2350.5, status: "open", opened_at: "2026-10-12T08:00:00Z" };

describe("findDuplicate", () => {
  it("matches the same MT5 trade uploaded twice", () => {
    expect(findDuplicate([row], { symbol: "xauusd", direction: "long", entry_price: 2350.5, opened_at: "2026-10-12T08:00:00Z" })?.id).toBe("1");
  });
  it("does not match a different entry price", () => {
    expect(findDuplicate([row], { symbol: "XAUUSD", direction: "long", entry_price: 2360 })).toBeNull();
  });
  it("does not match the opposite direction", () => {
    expect(findDuplicate([row], { symbol: "XAUUSD", direction: "short", entry_price: 2350.5 })).toBeNull();
  });
  it("does not match a trade from another day", () => {
    expect(findDuplicate([row], { symbol: "XAUUSD", direction: "long", entry_price: 2350.5, opened_at: "2026-10-15T08:00:00Z" })).toBeNull();
  });
  it("never matches without an entry price", () => {
    expect(findDuplicate([row], { symbol: "XAUUSD", direction: "long", entry_price: null })).toBeNull();
  });
});
