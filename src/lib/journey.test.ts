import { describe, expect, it } from "vitest";
import { forexSymbol, isForex } from "./forex";
import { pipelineState, type PipelineRows } from "./day-pipeline";
import { buildJourney, journeyForPrompt } from "./journey";
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
  it("accepts the indices and oil from the watchlist", () => {
    expect(forexSymbol("US30USD")).toBe("US30");
    expect(forexSymbol("US500")).toBe("US500");
    expect(forexSymbol("NAS100")).toBe("US100");
    expect(forexSymbol("USOIL")).toBe("USOIL");
    expect(forexSymbol("USOIL.m")).toBe("USOIL");
    expect(forexSymbol("US500.cash")).toBe("US500");
    expect(forexSymbol("USDJPY")).toBe("USDJPY");
  });
  it("rejects crypto and stocks", () => {
    for (const s of [
      "BTCUSD",
      "BTCUSDT",
      "بيتكوين",
      "ETHUSD",
      "2222",
      "AAPL",
      "USDUSD",
      "",
    ])
      expect(isForex(s), s).toBe(false);
  });
});

// The journey is an adapter over day-pipeline.ts: the same seven steps and the same current one.
const at = (hhmm: string) => `2026-10-14T${hhmm}:00+03:00`;
const FRESH: PipelineRows = {
  settings: {
    timezone: "Asia/Riyadh", current_balance: 10_000, max_daily_loss: 200, max_consecutive_losses: 2, streak_cooldown_hours: 24,
    breaker_since: "2026-10-01T00:00:00+03:00", limits_accepted_at: "2026-10-01T00:00:00+03:00",
  },
  trades: [],
  plan: null,
  sessions: [],
  focus: null,
  strategies: 0,
  rules: 0,
  now: new Date(at("15:00")),
};
const READY: PipelineRows = { ...FRESH, focus: { markets: ["EURUSD"], weakness: "الطمع" }, strategies: 1, rules: 2 };
const journey = (over: Partial<PipelineRows> = {}, base = READY) => buildJourney(pipelineState({ ...base, ...over }));
const loss = { id: "l", symbol: "EURUSD", direction: "long", entry_price: 1.1, exit_price: 1.0, status: "closed", pnl: -200, opened_at: at("10:00"), closed_at: at("11:00"), stop_loss: 1 };

describe("journey", () => {
  it("starts a new client on setup, the focus profile first", () => {
    const j = journey({}, FRESH);
    expect(j.current).toMatchObject({ key: "setup", n: 0, to: "/coach", phase: "setup" });
    expect(j.setupDone).toBe(false);
    expect(j.steps.map((s) => s.n)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
  it("walks the day once set up: plan, then the gate, then nothing left once the day is closed", () => {
    expect(journey().current).toMatchObject({ key: "plan", to: "/session" });
    const planned = { plan: { no_trading: false }, sessions: [{ started_at: at("09:00"), ended_at: null }] };
    expect(journey(planned).current).toMatchObject({ key: "trade", to: "/new-trade", cta: "صفقة جديدة" });
    const done = journey({ ...planned, sessions: [{ started_at: at("09:00"), ended_at: at("14:00") }] });
    expect(done.current).toBeNull();
    expect(journeyForPrompt(done)).toContain("أنهى");
  });
  it("when the breaker stops the day: the gate step, and «صفقة جديدة» is off", () => {
    const j = journey({ trades: [loss] });
    expect(j.current).toMatchObject({ key: "gate", n: 1 });
    expect(j.pipeline.newTrade).toBe(false);
    expect(journeyForPrompt(j)).toContain("صفقة جديدة مو مطروحة اليوم");
  });
  it("the nav marks the current step's page without moving it", () => {
    const rulesStep = journey({ rules: 0 }).current!;
    expect(rulesStep.to).toBe("/rules");
    expect(planNav({ nextStep: rulesStep.to }).next).toBe("/rules");
    expect(planNav({ nextStep: "/dashboard" }).next).toBeNull();
  });
});
