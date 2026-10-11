import { describe, expect, it } from "vitest";
import { forexSymbol, isForex } from "./forex";
import { buildJourney, journeyForPrompt, type JourneyState } from "./journey";
import { planNav } from "./nav-plan";

describe("forex only", () => {
  it("accepts pairs, metals, Arabic names and broker suffixes", () => {
    expect(forexSymbol("eur/usd")).toBe("EURUSD");
    expect(forexSymbol("EURUSD.m")).toBe("EURUSD");
    expect(forexSymbol("GBPJPYpro")).toBe("GBPJPY");
    expect(forexSymbol("ذهب")).toBe("XAUUSD");
    expect(forexSymbol("GOLD")).toBe("XAUUSD");
    expect(forexSymbol("XAGUSD")).toBe("XAGUSD");
  });
  it("rejects crypto, indices, oil and stocks", () => {
    for (const s of [
      "BTCUSD",
      "BTCUSDT",
      "بيتكوين",
      "ETHUSD",
      "NAS100",
      "US30",
      "USOIL",
      "2222",
      "AAPL",
      "USDUSD",
      "",
    ])
      expect(isForex(s), s).toBe(false);
  });
});

const fresh: JourneyState = {
  focusReady: false,
  strategies: 0,
  rules: 0,
  sessionToday: null,
  tradesToday: 0,
  blocked: false,
};
const ready = { ...fresh, focusReady: true, strategies: 1, rules: 2 };

describe("journey", () => {
  it("starts a new client on the focus profile", () => {
    const j = buildJourney(fresh);
    expect(j.current?.key).toBe("focus");
    expect(j.current?.to).toBe("/coach");
    expect(j.setupDone).toBe(false);
    expect(j.steps.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("walks the daily loop once set up", () => {
    expect(buildJourney(ready).current?.key).toBe("session");
    const active = { ...ready, sessionToday: { active: true, ended: false } };
    expect(buildJourney(active).current?.key).toBe("trade");
    expect(buildJourney({ ...active, tradesToday: 1 }).current?.key).toBe("close");
    const done = buildJourney({
      ...ready,
      tradesToday: 1,
      sessionToday: { active: false, ended: true },
    });
    expect(done.current).toBeNull();
    expect(journeyForPrompt(done)).toContain("أنهى");
  });
  it("when blocked: skips the trade step, and with no session there is nothing left today", () => {
    const blockedActive = buildJourney({
      ...ready,
      blocked: true,
      sessionToday: { active: true, ended: false },
    });
    expect(blockedActive.current?.key).toBe("close");
    expect(buildJourney({ ...ready, blocked: true }).current).toBeNull();
  });
  it("the nav pins the current step's page first", () => {
    const base = {
      strategies: 1,
      rules: 1,
      trades: 5,
      closed: 5,
      notes: 1,
      activeSession: false,
      violationsWeek: 0,
      blocked: false,
    };
    expect(planNav({ ...base, nextStep: "/rules" }).pinned[0]).toBe("/rules");
    expect(planNav({ ...base, nextStep: "/dashboard" }).pinned[0]).toBe("/session");
  });
});
