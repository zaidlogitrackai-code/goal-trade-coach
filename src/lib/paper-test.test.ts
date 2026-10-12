import { describe, expect, it } from "vitest";
import { stepTrade, summarizeTest, validScalp, TEST_MS, type PaperTrade } from "./paper-test";

const long: PaperTrade = { id: 1, symbol: "XAUUSD", direction: "long", entry: 100, stop: 98, target: 104, openedAt: 0, reason: "" };
const short: PaperTrade = { ...long, id: 2, direction: "short", stop: 102, target: 96 };

describe("paper self-test", () => {
  it("lasts 10 minutes", () => expect(TEST_MS).toBe(600_000));
  it("long hits target = +2R", () => expect(stepTrade(long, 104.5, 1)).toMatchObject({ outcome: "tp", r: 2 }));
  it("long hits stop = -1R", () => expect(stepTrade(long, 97, 1)).toMatchObject({ outcome: "sl", r: -1 }));
  it("short hits target = +2R", () => expect(stepTrade(short, 95, 1)).toMatchObject({ outcome: "tp", r: 2 }));
  it("stays open between stop and target", () => expect(stepTrade(long, 101, 1).outcome).toBeUndefined());
  it("time-out closes at market price", () => expect(stepTrade(long, 101, 1, true)).toMatchObject({ outcome: "time", r: 0.5 }));
  it("rejects a long with stop above entry", () => expect(validScalp("long", 100, 101, 104)).toBe(false));
  it("summary counts wins and total R", () => {
    const s = summarizeTest([stepTrade(long, 104, 1), stepTrade(short, 103, 1)]);
    expect(s).toMatchObject({ count: 2, wins: 1, losses: 1, winRate: 50, totalR: 1 });
  });
});
