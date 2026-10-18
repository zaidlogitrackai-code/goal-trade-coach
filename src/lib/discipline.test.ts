import { describe, expect, it } from "vitest";
import {
  disciplineReport,
  scoreSummary,
  todayInterventions,
  type DisciplineTrade,
} from "./discipline";
import { REVENGE_MARKER, revengeLine } from "./emotions";

const now = new Date("2026-10-11T18:00:00");
const tr = (o: Partial<DisciplineTrade> & { at: string; close?: string }): DisciplineTrade => ({
  status: o.close ? "closed" : "open",
  pnl: null,
  risk_amount: 50,
  stop_loss: 1,
  checklist_passed: true,
  emotion: "هادئ",
  notes: null,
  opened_at: o.at,
  closed_at: o.close ?? null,
  ...o,
});

describe("disciplineReport", () => {
  it("returns an empty report without trades", () => {
    const r = disciplineReport([], [], { maxRiskPerTrade: 100, now });
    expect(r.score).toBeNull();
    expect(scoreSummary(r)).toBeNull();
  });

  it("gives 100 for a clean record and explains why", () => {
    const r = disciplineReport(
      [tr({ at: "2026-10-11T09:00:00", close: "2026-10-11T09:30:00", pnl: 40 })],
      [],
      { maxRiskPerTrade: 100, now },
    );
    expect(r.score).toBe(100);
    expect(r.reasons.join(" ")).toContain("حددت وقف الخسارة في 1 من 1");
  });

  it("counts a quick re-entry after a loss and names it in the summary", () => {
    const trades = [
      tr({ at: "2026-10-11T09:00:00", close: "2026-10-11T09:20:00", pnl: -50 }),
      tr({ at: "2026-10-11T09:23:00", close: "2026-10-11T09:40:00", pnl: 30 }),
    ];
    const r = disciplineReport(trades, [], { maxRiskPerTrade: 100, now });
    expect(r.metrics.quickReentryCount).toBe(1);
    expect(r.metrics.revengeCount).toBe(1);
    expect(r.score).toBeLessThan(100);
    expect(scoreSummary(r)).toContain("خلال 5 دقائق بعد خسارة");
  });

  it("measures stop-loss adherence and losses beyond planned risk", () => {
    const trades = [
      tr({ at: "2026-10-10T09:00:00", close: "2026-10-10T10:00:00", pnl: -50, stop_loss: null }),
      tr({ at: "2026-10-10T11:00:00", close: "2026-10-10T12:00:00", pnl: -120 }),
    ];
    const r = disciplineReport(trades, [], { maxRiskPerTrade: 100, now });
    expect(r.metrics.stopLossSetRate).toBe(50);
    expect(r.metrics.lossWithinRiskRate).toBe(50);
  });

  it("detects trading on after two losses the same day", () => {
    const trades = [
      tr({ at: "2026-10-10T09:00:00", close: "2026-10-10T09:10:00", pnl: -10 }),
      tr({ at: "2026-10-10T10:00:00", close: "2026-10-10T10:10:00", pnl: -10 }),
      tr({ at: "2026-10-10T11:00:00" }),
    ];
    expect(
      disciplineReport(trades, [], { maxRiskPerTrade: 100, now }).metrics.tradesAfterTwoLosses,
    ).toBe(1);
  });

  it("reads self-declared revenge from the emotional check note", () => {
    const r = disciplineReport(
      [tr({ at: "2026-10-11T09:00:00", emotion: "غاضب", notes: `— فحص —\n${REVENGE_MARKER}` })],
      [],
      { maxRiskPerTrade: 0, now },
    );
    expect(r.metrics.selfDeclaredRevenge).toBe(1);
  });

  it("counts exactly what the trade form writes for each answer", () => {
    const r = disciplineReport(
      [
        tr({ at: "2026-10-11T09:00:00", emotion: "طمع", notes: `دافع\n${revengeLine(true)}` }),
        tr({ at: "2026-10-11T10:00:00", emotion: "طمع", notes: `دافع\n${revengeLine(false)}` }),
      ],
      [],
      { maxRiskPerTrade: 0, now },
    );
    expect(r.metrics.selfDeclaredRevenge).toBe(1);
  });

  it("groups results by emotion", () => {
    const trades = [
      tr({ at: "2026-10-10T09:00:00", close: "2026-10-10T09:10:00", pnl: -30, emotion: "طمع" }),
      tr({ at: "2026-10-10T10:00:00", close: "2026-10-10T10:10:00", pnl: 10, emotion: "طمع" }),
      tr({ at: "2026-10-10T11:00:00", close: "2026-10-10T11:10:00", pnl: 20, emotion: "هادئ" }),
    ];
    const r = disciplineReport(trades, [], { maxRiskPerTrade: 0, now });
    expect(r.metrics.greedCount).toBe(2);
    expect(r.emotionVsResult[0]).toMatchObject({
      emotion: "طمع",
      count: 2,
      wins: 1,
      winRate: 50,
      pnl: -20,
    });
  });

  it("ignores trades older than 30 days in the score", () => {
    const old = tr({ at: "2026-08-01T09:00:00", stop_loss: null, checklist_passed: false });
    expect(disciplineReport([old], [], { maxRiskPerTrade: 0, now }).score).toBeNull();
  });
});

describe("todayInterventions", () => {
  it("suggests a cooldown after two losses today, never a trade", () => {
    const trades = [
      tr({ at: "2026-10-11T09:00:00", close: "2026-10-11T09:10:00", pnl: -10 }),
      tr({ at: "2026-10-11T10:00:00", close: "2026-10-11T10:10:00", pnl: -10 }),
    ];
    const out = todayInterventions(trades, [], now);
    expect(out.map((x) => x.kind)).toEqual(["cooldown"]);
    expect(out[0]!.message).toContain("تهدئة");
  });

  it("asks for a short review after a violating trade today", () => {
    expect(
      todayInterventions([], [{ occurred_at: "2026-10-11T12:00:00", trade_id: "t1" }], now).map(
        (x) => x.kind,
      ),
    ).toEqual(["review"]);
  });

  it("compares today's trade count with the user's average", () => {
    const past = ["2026-10-06", "2026-10-07", "2026-10-08"].map((d) => tr({ at: `${d}T09:00:00` }));
    const today = [9, 10, 11, 12].map((h) =>
      tr({ at: `2026-10-11T${String(h).padStart(2, "0")}:00:00` }),
    );
    const out = todayInterventions([...past, ...today], [], now);
    expect(out.find((x) => x.kind === "overtrading")?.message).toContain("متوسطك 1");
  });
});
