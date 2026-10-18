import { describe, expect, it } from "vitest";
import { REVENGE_MARKER, revengeLine } from "./emotions";
import {
  acceptRule, activeTempRules, exitR, heatAtEntry, lossesBefore, realizedR, reviewRow, reviewTrade, riskAtEntry,
  stricterVerdict, VERDICT_RANK,
  type HistoryTrade, type NextRule, type ReviewAnalysis, type ReviewBreak, type ReviewCheck, type ReviewCtx, type ReviewEvent,
  type ReviewPlan, type ReviewSettings, type ReviewTrade, type ReviewViolation, type TradeReview, type Verdict,
} from "./trade-review";
import type { Database } from "@/integrations/supabase/types";

// The review takes the rows exactly as Supabase returns them (fails tsc if a column changes).
type Tables = Database["public"]["Tables"];
export const rowsFit = (
  t: Tables["trades"]["Row"], c: Tables["pre_trade_checks"]["Row"], e: Tables["trade_events"]["Row"],
  v: Tables["rule_violations"]["Row"], b: Tables["circuit_breaks"]["Row"], p: Tables["daily_plans"]["Row"],
  a: Tables["chart_analyses"]["Row"], s: Tables["trading_settings"]["Row"],
) =>
  [t, c, e, v, b, p, a, s, p] satisfies [
    ReviewTrade, ReviewCheck, ReviewEvent, ReviewViolation, ReviewBreak, ReviewPlan, ReviewAnalysis, ReviewSettings,
    Parameters<typeof activeTempRules>[0][number],
  ];

const TZ = "Asia/Riyadh";
const NOW = "2026-10-14T15:00:00+03:00"; // Wednesday
const at = (min: number) => new Date(Date.parse(NOW) + min * 60_000).toISOString();

// $50 per trade, $200 a day, $500 a week; cooldown 15 → the revenge window is 30 minutes.
const SETTINGS: ReviewSettings = { max_risk_per_trade: 50, cooldown_minutes: 15, max_daily_loss: 200, weekly_max_loss: 500, timezone: TZ };
const PLAN: ReviewPlan = { set_at: "2026-10-14T08:00:00+03:00", risk_per_trade: null, max_loss: null };
const YES = { in_written_plan: true, stop_predefined: true, size_within_plan: true, not_revenge: true };

let seq = 0;
// XAUUSD 0.1 lot long at 2400 with the stop at 2395 = $50, target 2410 = 2R; stopped out for −$50.
function trade(over: Partial<ReviewTrade> = {}): ReviewTrade {
  seq++;
  return {
    id: `t${seq}`, symbol: "XAUUSD", direction: "long", status: "closed",
    entry_price: 2400, exit_price: 2395, stop_loss: 2395, initial_stop_loss: 2395, take_profit: 2410, position_size: 0.1,
    risk_amount: 50, risk_source: "computed", source: "form", pnl: -50,
    opened_at: at(-60), closed_at: at(-20),
    notes: "ارتداد من دعم 2400 على الساعة، الوقف تحت القاع.", close_notes: "ضرب الوقف، مشيت على الخطة.",
    emotion: "هادئ", exit_emotion: "هادئ", exit_reason: "stop",
    ...over,
  };
}
/** An earlier close, for the history. */
const closed = (pnl: number, closeMin: number, over: Partial<HistoryTrade> = {}): HistoryTrade => {
  seq++;
  return {
    id: `h${seq}`, symbol: "XAUUSD", status: "closed", pnl, risk_amount: 50, risk_source: "computed", source: "form",
    opened_at: at(closeMin - 15), closed_at: at(closeMin), ...over,
  };
};
const check = (over: Partial<ReviewCheck> = {}): ReviewCheck => ({
  id: "c1", intent: "pre_entry", decision: "GO", answers: YES, reasons: [], planned_risk: 50, actual_risk: 50, override_reason: null, ...over,
});
const reason = (code: string, decision: "NO_GO" | "REVIEW_REQUIRED", text = code) => ({ code, decision, text });
const ctx = (over: Partial<ReviewCtx> = {}): ReviewCtx => ({
  settings: SETTINGS, allTrades: [], check: check(), events: [], plan: PLAN, latchedBreaks: [], now: new Date(NOW), ...over,
});
const review = (t: ReviewTrade, over: Partial<ReviewCtx> = {}) => reviewTrade(t, ctx({ ...over, allTrades: [t, ...(over.allTrades ?? [])] }));

const tagsOf = (r: TradeReview) => r.tags.map((x) => x.tag);
const all = (r: TradeReview) => [...r.process, ...r.risk, ...r.execution];
const find = (r: TradeReview, rule: string) => all(r).find((f) => f.rule === rule);
const criticals = (r: TradeReview) => all(r).filter((f) => f.severity === "critical").map((f) => f.rule);
const HALT: ReviewBreak = { rule: "max_daily_loss", state: "HALTED", triggered_at: at(-180), active_until: at(600), released_at: null };

// The skill's seven fixtures (scripts/tests/fixtures), as the app's own rows.
describe("the skill's fixtures", () => {
  it("single_trade_clean_loss: OK, randomness, a full risk score and only no_pattern_detected", () => {
    const r = review(trade());
    expect(r.verdict).toBe("ok");
    expect(r.rootCause).toBe("randomness");
    expect(r.scores).toEqual({ process: 100, risk: 100, execution: 100, quality: 100 });
    expect(tagsOf(r)).toEqual(["no_pattern_detected"]);
    expect(r.quadrant).toBe("clean_loss");
    expect(r.confidence).toBe("high");
    expect(r.missingFields).toEqual([]);
    expect(r.facts).toMatchObject({ plannedRisk: 50, actualRisk: 50, sizeRatio: 1, realizedR: -1, exitR: -1, plannedRR: 2, heat: 50, room: 200 });
    expect(r.nextRules).toEqual([expect.objectContaining({ trigger: "none", duration: "next_session" })]);
  });

  it("single_trade_rule_violation_loss: COOL_DOWN with fomo, size creep, a moved stop and the 0.5R rule", () => {
    const other: HistoryTrade = { id: "o1", symbol: "XAUUSD", status: "open", pnl: null, risk_amount: 120, risk_source: "typed", source: "form", opened_at: at(-90), closed_at: null };
    const t = trade({
      position_size: 0.18, risk_amount: 90, exit_price: 2388, pnl: -216, stop_loss: 2388,
      emotion: "خوف من الفوات", notes: "ما بغيت يفوتني الصعود، السعر كان طاير.", close_notes: "دخلت قبل التأكيد ووسعت الوقف لما عكس.",
    });
    const r = review(t, {
      allTrades: [other],
      check: check({
        decision: "NO_GO", answers: { ...YES, in_written_plan: false, size_within_plan: false }, actual_risk: 90,
        reasons: [reason("breaker", "NO_GO", "التداول موقوف: خسارة اليوم وصلت حدّك."), reason("not_in_plan", "NO_GO"), reason("risk_over_plan", "NO_GO")],
      }),
      events: [{ trade_id: t.id, kind: "stop_moved", at: at(-40), old_value: 2395, new_value: 2388, planned: false }],
      latchedBreaks: [HALT],
      postmortem: { rootCause: "rule_violation", note: "دخلت قبل التأكيد وحركت الوقف بعد ما مشت ضدي." },
    });
    expect(r.verdict).toBe("cooldown");
    expect(tagsOf(r)).toEqual(expect.arrayContaining(["fomo_entry", "size_creep", "stop_moved"]));
    expect(find(r, "setup_confirmation")?.severity).toBe("critical");
    expect(find(r, "market_regime_gate")?.severity).toBe("critical");
    expect(find(r, "position_size")?.severity).toBe("critical");
    expect(find(r, "portfolio_heat")?.severity).toBe("critical");
    expect(find(r, "stop")).toMatchObject({ severity: "critical", evidence: expect.stringContaining("وسّعت") });
    // One NO_GO, one finding: the plan «لا» and the size are judged by their own rules.
    expect(r.process.filter((f) => f.rule === "market_regime_gate")).toHaveLength(1);
    expect(find(r, "size_within_plan")).toBeUndefined();
    expect(r.rootCause).toBe("rule_violation");
    expect(r.nextRules.some((x) => x.trigger === "size_creep" && x.text.includes("0.5R") && x.duration === "next_two_trades")).toBe(true);
  });

  it("partial_close_stop_moved: a partial review that flags the unplanned stop move", () => {
    const t = trade({ status: "open", exit_price: null, pnl: null, closed_at: null, stop_loss: 2398, exit_reason: null, close_notes: null, exit_emotion: null });
    const r = review(t, {
      events: [
        { trade_id: t.id, kind: "partial_close", at: at(-30), realized_pnl: 43, old_value: null, new_value: null, planned: true },
        { trade_id: t.id, kind: "stop_moved", at: at(-25), old_value: 2395, new_value: 2398, planned: false },
      ],
      postmortem: { rootCause: "execution", note: "الجزئي تمام، بس حركت الوقف بيدي بدون قاعدة مكتوبة." },
    });
    expect(r.reviewType).toBe("partial_close");
    expect(["violation", "review", "cooldown"]).toContain(r.verdict);
    expect(tagsOf(r)).toContain("stop_moved");
    expect(r.execution.some((f) => f.rule === "stop")).toBe(true);
    expect(r).toMatchObject({ outcome: "open", quadrant: null, rootCause: "execution" });
  });

  it("monthly_aggregate_revenge_pattern: revenge after three losses → COOL_DOWN and a review-only session", () => {
    const history = [closed(-50, -200), closed(-50, -150), closed(-50, -70)];
    const t = trade({
      position_size: 0.14, risk_amount: 70, pnl: -70, emotion: "غاضب",
      notes: "بعد خسارتين زودت الحجم عشان أعوض.", close_notes: "كنت أبي أرجع اللي خسرت بسرعة.",
    });
    const r = review(t, { allTrades: history, check: check({ actual_risk: 70, answers: null }), postmortem: { rootCause: "risk_sizing" } });
    expect(r.verdict).toBe("cooldown");
    expect(tagsOf(r)).toContain("revenge_trade");
    expect(find(r, "losing_streak")?.severity).toBe("warning");
    expect(r.facts.lossesBefore).toBe(3);
    expect(r.rootCause).toBe("risk_sizing");
    expect(r.nextRules[0]).toMatchObject({ trigger: "revenge_trade", duration: "next_session" });
    expect(r.nextRules[0]!.text).toContain("مراجعة بس");
  });

  it("incomplete_record: degrades to WARN without crashing, low quality, unclear findings", () => {
    const t = trade({
      source: "backfill", risk_source: "unknown", risk_amount: 0, stop_loss: null, initial_stop_loss: null, take_profit: null,
      position_size: null, exit_price: null, pnl: null, notes: "لازم أضيف التفاصيل بعدين.", close_notes: null,
      exit_reason: null, emotion: null, exit_emotion: null,
    });
    const r = reviewTrade(t, { settings: null, allTrades: [t], check: null, plan: null, now: new Date(NOW) });
    expect(["review", "warn"]).toContain(r.verdict);
    expect(r.verdict).toBe("warn");
    expect(r.scores.quality).toBeLessThan(80);
    expect(r.process.some((f) => f.status === "unclear")).toBe(true);
    expect(r).toMatchObject({ outcome: "unknown", quadrant: null, rootCause: "unknown", confidence: "low" });
    expect(r.missingFields).toEqual(["risk", "planned_risk", "entry_stop", "answers", "exit_reason", "close_notes"]);
  });

  it("single_trade_premature_exit: a fear exit far from the target is never OK", () => {
    const t = trade({ exit_price: 2399, pnl: -10, exit_reason: "fear", exit_emotion: "خائف", close_notes: "خفت يرجع فقفلتها، الوقف ما انضرب." });
    const r = review(t);
    expect(r.verdict).not.toBe("ok");
    expect(r.verdict).toBe("review");
    expect(r.execution).toEqual([expect.objectContaining({ rule: "exit", severity: "warning" })]);
    expect(tagsOf(r)).toContain("premature_exit");
    expect(r.facts.exitR).toBe(-0.2);
    expect(r.rootCause).toBe("execution");
  });

  it("risk_data_missing_no_size_creep: unknown size is not size creep, and the rule asks for the numbers", () => {
    const t = trade({ source: "backfill", risk_source: "unknown", risk_amount: 0, position_size: null, notes: "مشيت على الخطة، وضرب الوقف." });
    const r = review(t, { check: null });
    const tags = tagsOf(r);
    expect(tags).not.toContain("size_creep");
    expect(tags).toContain("unknown_size");
    expect(r.risk.some((f) => f.rule === "position_size" && f.severity === "warning" && f.status === "unclear")).toBe(true);
    expect(r.nextRules.every((x) => !x.text.includes("0.5R"))).toBe(true);
    expect(r.nextRules.every((x) => !x.reason.includes("أكبر"))).toBe(true);
    expect(r.nextRules.some((x) => x.trigger === "unknown_size" && x.text.includes("سجّل المخاطرة"))).toBe(true);
    expect(r.verdict).toBe("warn");
  });
});

describe("process", () => {
  it("a NO_GO entered at 1.0× during a HALT → one critical, violation (not a cooldown)", () => {
    // The day's $200 is used up: the halt is the finding, the heat over a zero room is not a second one.
    const history = [closed(-120, -200), closed(-80, -120)];
    const r = review(trade(), {
      allTrades: history,
      check: check({ decision: "NO_GO", reasons: [reason("breaker", "NO_GO", "التداول موقوف: خسارة اليوم 200$ وصلت حدّك 200$.")] }),
      latchedBreaks: [HALT],
      violations: [{ trade_id: null, pre_trade_check_id: "c1", source: "gate", note: "دخلت رغم القرار" }],
    });
    expect(r.verdict).toBe("violation");
    expect(criticals(r)).toEqual(["market_regime_gate"]);
    expect(find(r, "market_regime_gate")!.evidence).toContain("موقوف");
    expect(r.rootCause).toBe("market_environment");
    expect(r.facts).toMatchObject({ sizeRatio: 1, room: 0 });
  });

  it("entering inside a latched break is critical even with no check", () => {
    const r = review(trade(), { check: null, latchedBreaks: [{ ...HALT, rule: "losing_streak_cooldown", state: "COOLDOWN" }] });
    expect(find(r, "market_regime_gate")).toMatchObject({ severity: "critical", evidence: expect.stringContaining("بتهدئة") });
    // A released, expired or future break doesn't count.
    for (const b of [{ ...HALT, released_at: at(-90) }, { ...HALT, active_until: at(-90) }, { ...HALT, triggered_at: at(-30) }, { ...HALT, rule: "max_trades" }])
      expect(find(review(trade(), { latchedBreaks: [b] }), "market_regime_gate")).toBeUndefined();
  });

  it("an explicit «لا» on the plan → a critical setup_confirmation with fomo_entry, judged once", () => {
    const r = review(trade(), { check: check({ decision: "NO_GO", answers: { ...YES, in_written_plan: false }, reasons: [reason("not_in_plan", "NO_GO")] }) });
    expect(find(r, "setup_confirmation")).toMatchObject({ status: "missed", severity: "critical" });
    expect(find(r, "market_regime_gate")).toBeUndefined();
    expect(r.verdict).toBe("violation");
    expect(r.tags).toContainEqual(expect.objectContaining({ tag: "fomo_entry", confidence: "high" }));
    expect(r.rootCause).toBe("rule_violation");
    expect(r.quadrant).toBe("dirty_loss");
  });

  it("an explicit «لا» on the stop or the size → critical; a NO_GO for an unjudged reason still counts", () => {
    expect(find(review(trade(), { check: check({ answers: { ...YES, stop_predefined: false } }) }), "stop_predefined")?.severity).toBe("critical");
    expect(find(review(trade(), { check: check({ answers: { ...YES, size_within_plan: false } }) }), "size_within_plan")?.severity).toBe("critical");
    const r = review(trade(), { check: check({ decision: "NO_GO", answers: { ...YES, in_written_plan: false }, reasons: [reason("not_in_plan", "NO_GO"), reason("rest_day", "NO_GO", "اليوم يوم راحة في خطتك.")] }) });
    expect(criticals(r)).toEqual(["market_regime_gate", "setup_confirmation"]);
    expect(find(r, "market_regime_gate")!.evidence).toContain("يوم راحة");
    expect(r.verdict).toBe("cooldown");
  });

  it("a trade with no stop is critical; an old backfilled one is only unclear", () => {
    expect(find(review(trade({ initial_stop_loss: 0, stop_loss: 0 })), "stop_predefined")).toMatchObject({ status: "missed", severity: "critical" });
    expect(find(review(trade({ initial_stop_loss: null, stop_loss: null, source: "backfill" })), "stop_predefined")).toMatchObject({ status: "unclear", severity: "warning" });
    // A stop set after the entry: the first move's old value was the stop he entered with.
    const t = trade({ initial_stop_loss: null, stop_loss: 2395 });
    const r = review(t, { events: [{ trade_id: t.id, kind: "stop_moved", at: at(-50), old_value: 0, new_value: 2395, planned: false }] });
    expect(find(r, "stop_predefined")?.severity).toBe("critical");
  });

  it("no answers is unclear, never missed", () => {
    for (const c of [check({ answers: null }), check({ answers: {} }), null]) {
      const r = review(trade(), { check: c });
      expect(find(r, "gate_answers")).toMatchObject({ status: "unclear", severity: "warning" });
      expect(r.process.filter((f) => f.status === "missed")).toEqual([]);
      expect(r.verdict).toBe("warn");
      expect(r.quadrant).toBe("clean_loss");
    }
  });

  it("no thesis before the entry → a pre_entry_thesis_record warning", () => {
    const bare = { notes: null, plan: null } as const;
    const r = review(trade({ notes: bare.notes }), { plan: bare.plan });
    expect(find(r, "pre_entry_thesis_record")).toMatchObject({ status: "missed", severity: "warning" });
    expect(r.verdict).toBe("review");
    expect(r.missingFields).toContain("entry_notes");
    // Only the app's own revenge line is not a reason.
    expect(find(review(trade({ notes: revengeLine(false) }), { plan: null }), "pre_entry_thesis_record")?.status).toBe("missed");
    // An analysis, or the day's plan, written before the entry is a thesis on record; one written after is not.
    expect(find(review(trade({ notes: null }), { plan: null, analysisCard: { created_at: at(-90) } }), "pre_entry_thesis_record")?.status).toBe("met");
    expect(find(review(trade({ notes: null }), { plan: null, analysisCard: { created_at: at(-30) } }), "pre_entry_thesis_record")?.status).toBe("missed");
    expect(find(review(trade({ notes: null }), { plan: { set_at: at(-90) } }), "pre_entry_thesis_record")?.status).toBe("met");
    expect(find(review(trade({ notes: null }), { plan: { set_at: at(-30) } }), "pre_entry_thesis_record")?.status).toBe("missed");
  });

  it("three skipped reviews at the gate → rule_drift", () => {
    const r = review(trade(), {
      check: check({
        decision: "REVIEW_REQUIRED",
        reasons: [reason("no_plan", "REVIEW_REQUIRED"), reason("outside_session", "REVIEW_REQUIRED"), reason("protect_profit", "REVIEW_REQUIRED"), reason("unanswered", "REVIEW_REQUIRED")],
      }),
    });
    expect(r.process.filter((f) => f.rule === "gate_review")).toHaveLength(3); // a blank answer is not a skipped step
    expect(tagsOf(r)).toContain("rule_drift");
    expect(r.verdict).toBe("review");
    expect(r.scores.process).toBe(55);
  });

  it("a violation he logged on the trade is critical; gate rows are the NO_GO itself", () => {
    const t = trade();
    const r = review(t, { violations: [{ trade_id: t.id, source: "manual", note: "دخلت بالأخبار" }, { trade_id: "other", source: "manual", note: null }] });
    expect(find(r, "logged_violation")).toMatchObject({ severity: "critical", evidence: expect.stringContaining("دخلت بالأخبار") });
    expect(r.rootCause).toBe("rule_violation");
    expect(find(review(t, { violations: [{ trade_id: t.id, source: "gate", note: null }] }), "logged_violation")).toBeUndefined();
    // With no check to read, a gate row still says he entered on a NO_GO.
    expect(find(review(t, { check: null, violations: [{ trade_id: t.id, source: "gate", note: null }] }), "market_regime_gate")).toBeDefined();
  });
});

describe("risk", () => {
  const sized = (risk: number) => trade({ risk_amount: risk, position_size: risk / 500 });

  it("size: >1.25× critical, >1× warning, exactly 1.25× a warning", () => {
    expect(find(review(sized(63)), "position_size")?.severity).toBe("critical");
    expect(find(review(sized(62.5)), "position_size")?.severity).toBe("warning");
    expect(find(review(sized(55)), "position_size")?.severity).toBe("warning");
    expect(find(review(sized(50)), "position_size")).toMatchObject({ status: "met", severity: "info" });
    expect(tagsOf(review(sized(55)))).toContain("size_creep");
    // The plan's tighter risk wins over the per-trade limit; the check's snapshot wins over both.
    expect(review(trade(), { check: check({ planned_risk: null }), plan: { ...PLAN, risk_per_trade: 40 } }).facts).toMatchObject({ plannedRisk: 40, sizeRatio: 1.25 });
    expect(review(trade({ risk_amount: 40 }), { check: check({ actual_risk: 60 }) }).facts.actualRisk).toBe(60);
  });

  it("a backfilled 0, a legacy 0 or risk_source unknown → unknown_size, never a computed guess", () => {
    for (const over of [{ source: "backfill" }, { risk_source: "legacy_recomputed" }, { risk_source: "unknown", risk_amount: 80 }] as Partial<ReviewTrade>[]) {
      const r = review(trade({ risk_amount: 0, ...over }), { check: null });
      expect(tagsOf(r)).toContain("unknown_size");
      expect(find(r, "position_size")).toMatchObject({ status: "unclear", severity: "warning" });
      expect(r.facts.actualRisk).toBeNull();
    }
    // A new row with no typed risk: what its lots risked at the entry stop.
    expect(riskAtEntry({ symbol: "XAUUSD", risk_amount: 0, risk_source: "typed", source: "form", entry_price: 2400, initial_stop_loss: 2395, position_size: 0.1 })).toBe(50);
    expect(riskAtEntry({ symbol: "XAUUSD", risk_amount: 0, source: "backfill", entry_price: 2400, initial_stop_loss: 2395, position_size: 0.1 })).toBeNull();
    expect(riskAtEntry({ symbol: "XAUUSD", risk_amount: 30, risk_source: "legacy_recomputed" })).toBe(30);
  });

  it("heat: >0.9× of the day's room a warning, >1× critical", () => {
    const open = (risk: number): HistoryTrade => ({ id: `o${risk}`, symbol: "XAUUSD", status: "open", pnl: null, risk_amount: risk, opened_at: at(-120), closed_at: null });
    expect(find(review(trade(), { allTrades: [open(100)] }), "portfolio_heat")).toBeUndefined(); // 150 of 200
    expect(find(review(trade(), { allTrades: [open(135)] }), "portfolio_heat")?.severity).toBe("warning"); // 185
    expect(find(review(trade(), { allTrades: [open(160)] }), "portfolio_heat")?.severity).toBe("critical"); // 210
    // A loss earlier today shrinks the room; a trade closed before the entry is not open heat.
    const r = review(trade(), { allTrades: [closed(-120, -90, { risk_amount: 160 })] });
    expect(r.facts).toMatchObject({ heat: 50, room: 80 });
    expect(find(r, "portfolio_heat")).toBeUndefined();
  });

  it("three losses in a row before the entry warn, four are critical; break-even breaks the streak", () => {
    const three = [closed(-50, -300), closed(-50, -250), closed(-50, -200)];
    expect(find(review(trade(), { allTrades: three }), "losing_streak")?.severity).toBe("warning");
    expect(find(review(trade(), { allTrades: [closed(-50, -350), ...three] }), "losing_streak")?.severity).toBe("critical");
    expect(find(review(trade(), { allTrades: [closed(-50, -350), closed(0, -320), ...three.slice(1)] }), "losing_streak")).toBeUndefined();
  });

  it("the week within 10% of its loss limit → a warning", () => {
    // Monday and Tuesday: 460 of 500 lost before Wednesday's entry.
    const week = [closed(-230, -2 * 1440), closed(-230, -1440)];
    expect(find(review(trade(), { allTrades: week }), "weekly_limit")?.severity).toBe("warning");
    expect(find(review(trade(), { allTrades: [closed(-400, -1440)] }), "weekly_limit")).toBeUndefined();
    // Last week's losses don't count.
    expect(find(review(trade(), { allTrades: [closed(-480, -4 * 1440)] }), "weekly_limit")).toBeUndefined();
  });

  it("risk over the plan right after a winner → overconfidence_after_winner", () => {
    const r = review(sized(55), { allTrades: [closed(80, -70)], check: check({ actual_risk: 55 }) });
    expect(find(r, "overconfidence_after_winner")?.severity).toBe("warning");
    expect(r.tags).toContainEqual(expect.objectContaining({ tag: "overconfidence_after_winner", confidence: "high" }));
    expect(r.verdict).toBe("review");
    // On plan, after a loss, or after yesterday's winner: no.
    expect(find(review(trade(), { allTrades: [closed(80, -70)] }), "overconfidence_after_winner")).toBeUndefined();
    expect(find(review(sized(55), { allTrades: [closed(-80, -70)] }), "overconfidence_after_winner")).toBeUndefined();
    expect(find(review(sized(55), { allTrades: [closed(80, -1440)] }), "overconfidence_after_winner")).toBeUndefined();
  });
});

describe("execution", () => {
  const moved = (t: ReviewTrade, from: number, to: number, planned: boolean | null): ReviewEvent =>
    ({ trade_id: t.id, kind: "stop_moved", at: at(-40), old_value: from, new_value: to, planned });

  it("an unplanned stop move: wider is critical, tighter a warning, planned is fine", () => {
    const t = trade();
    expect(find(review(t, { events: [moved(t, 2395, 2390, false)] }), "stop")?.severity).toBe("critical");
    expect(find(review(t, { events: [moved(t, 2395, 2398, null)] }), "stop")?.severity).toBe("warning");
    expect(find(review(t, { events: [moved(t, 2395, 0, false)] }), "stop")?.severity).toBe("critical"); // removed
    expect(find(review(t, { events: [moved(t, 2395, 2400, true)] }), "stop")).toMatchObject({ status: "met", severity: "info" });
    expect(tagsOf(review(t, { events: [moved(t, 2395, 2400, true)] }))).not.toContain("stop_moved");
    // A short's stop is above: moving it up is wider.
    const s = trade({ direction: "short", entry_price: 2400, initial_stop_loss: 2405, stop_loss: 2405, take_profit: 2390, exit_price: 2405 });
    expect(find(review(s, { events: [moved(s, 2405, 2410, false)] }), "stop")?.severity).toBe("critical");
  });

  it("a stop that differs from the entry stop with no event moved without a plan", () => {
    const r = review(trade({ stop_loss: 2390, exit_price: 2390, pnl: -100 }));
    expect(find(r, "stop")).toMatchObject({ severity: "critical", evidence: expect.stringContaining("من 2395 إلى 2390") });
    expect(tagsOf(r)).toContain("stop_moved");
    expect(r.nextRules.some((x) => x.trigger === "stop_moved" && x.duration === "next_month")).toBe(true);
  });

  it("a premature exit needs fear and |exitR| < 0.8 × the planned R:R", () => {
    const fear = { exit_reason: "fear", pnl: -10, exit_price: 2399 } as const;
    expect(find(review(trade(fear)), "exit")?.severity).toBe("warning");
    expect(find(review(trade({ ...fear, exit_reason: "other", exit_emotion: "متوتر" })), "exit")).toBeDefined();
    expect(find(review(trade({ ...fear, exit_reason: "other", close_notes: "طلعت بدري" })), "exit")).toBeDefined();
    // No fear, no target, at the target's distance, or at the stop: not early.
    expect(find(review(trade({ ...fear, exit_reason: "time" })), "exit")).toBeUndefined();
    expect(find(review(trade({ ...fear, take_profit: null })), "exit")).toBeUndefined();
    expect(find(review(trade({ ...fear, exit_price: 2409, pnl: 90 })), "exit")).toBeUndefined();
    expect(find(review(trade({ exit_emotion: "خائف" })), "exit")).toBeUndefined();
  });

  it("adding to a loser is critical; an unplanned add a warning", () => {
    const t = trade();
    const add = (planned: boolean | null): ReviewEvent => ({ trade_id: t.id, kind: "size_added", at: at(-40), old_value: 0.1, new_value: 0.2, planned });
    const r = review(t, { events: [add(true)] });
    expect(find(r, "size_added")?.severity).toBe("critical");
    expect(tagsOf(r)).toContain("added_to_loser");
    expect(r.nextRules.some((x) => x.trigger === "added_to_loser")).toBe(true);
    const win = trade({ exit_price: 2410, pnl: 100, exit_reason: "target" });
    expect(find(review(win, { events: [{ ...add(null), trade_id: win.id }] }), "size_added")?.severity).toBe("warning");
    expect(find(review(win, { events: [{ ...add(true), trade_id: win.id }] }), "size_added")?.severity).toBe("info");
  });
});

describe("his own words", () => {
  it("catches revenge, FOMO, premature exits, overconfidence and hesitation, quoting the line", () => {
    const words = (notes: string) => review(trade({ notes }), { check: check({ answers: { in_written_plan: true } }) });
    expect(words("دخلت عشان أعوّض الخسارة").tags[0]).toMatchObject({ tag: "revenge_trade", evidence: "من ملاحظاتك: «دخلت عشان أعوّض الخسارة»" });
    expect(tagsOf(words("FOMO، السعر طار"))).toContain("fomo_entry");
    expect(tagsOf(words("خفت من الأخبار"))).toContain("premature_exit");
    expect(tagsOf(words("صفقة مضمونة"))).toContain("overconfidence_after_winner");
    expect(tagsOf(words("ترددت وتأخرت بالدخول"))).toContain("hesitation");
  });

  it("a negation or the app's own «لا» line is not a confession", () => {
    expect(tagsOf(review(trade({ notes: "مو صفقة تعويض، إعداد واضح" })))).toEqual(["no_pattern_detected"]);
    expect(tagsOf(review(trade({ notes: `إعداد واضح\n${revengeLine(false)}` })))).toEqual(["no_pattern_detected"]);
    expect(review(trade({ notes: `إعداد واضح\n${REVENGE_MARKER}` })).tags[0]).toMatchObject({ tag: "revenge_trade", confidence: "high" });
  });

  it("an entry inside the revenge window is a possible revenge trade; with two losses before it, a cooldown", () => {
    const r = review(trade(), { allTrades: [closed(-50, -70)] });
    expect(r.tags[0]).toMatchObject({ tag: "revenge_trade", evidence: expect.stringContaining("نافذة الانتقام (30 دقيقة)") });
    expect(r.facts.minutesSinceLoss).toBe(10);
    expect(r.verdict).toBe("ok"); // a pattern to look at, not a broken rule
    expect(review(trade(), { allTrades: [closed(-50, -120), closed(-50, -70)] }).verdict).toBe("cooldown");
    expect(tagsOf(review(trade(), { allTrades: [closed(-50, -100)] }))).toEqual(["no_pattern_detected"]); // 40 min: outside
  });
});

describe("the result", () => {
  it("a clean on-plan loss: [no_pattern_detected], خسارة نظيفة, randomness", () => {
    const r = review(trade());
    expect(tagsOf(r)).toEqual(["no_pattern_detected"]);
    expect(r.quadrantLabel).toBe("خسارة نظيفة");
    expect(r.rootCause).toBe("randomness");
    expect(r.questions).toEqual([r.tags[0]!.question]);
  });

  it("the quadrant crosses process and result; break-even sits with the wins", () => {
    const win = { exit_price: 2410, pnl: 100, exit_reason: "target" } as const;
    expect(review(trade(win)).quadrantLabel).toBe("ربح مستحق");
    expect(review(trade({ ...win, notes: null }), { plan: null }).quadrantLabel).toBe("ربح بالحظ");
    expect(review(trade({ notes: null }), { plan: null }).quadrantLabel).toBe("خسارة مستحقة");
    expect(review(trade({ pnl: 0, exit_price: 2400 })).quadrant).toBe("clean_win");
    expect(review(trade(win)).rootCause).toBe("unknown");
  });

  it("scores: −30 per critical, −15 per warning; quality = 40 + 60 × present / 7", () => {
    const r = review(trade({ exit_reason: null, close_notes: null }), { check: check({ answers: null }) });
    expect(r.scores).toMatchObject({ process: 85, quality: 74 }); // 4 of 7: 40 + 34.3
    expect(r.confidence).toBe("medium");
    expect(review(trade({ initial_stop_loss: 0, stop_loss: 0, notes: null }), { plan: null }).scores.process).toBe(55);
  });

  it("the postmortem's own root cause wins; a value outside the CHECK is ignored", () => {
    expect(review(trade(), { postmortem: { rootCause: "thesis_quality" } }).rootCause).toBe("thesis_quality");
    expect(review(trade(), { postmortem: { rootCause: "bad luck" } }).rootCause).toBe("randomness");
  });

  it("questions are the first four tags' questions, and tags are never empty", () => {
    const t = trade({ notes: "عشان أعوض، FOMO، ترددت", position_size: 0.2, risk_amount: 100, exit_reason: "fear", exit_price: 2399, pnl: -20 });
    const r = review(t, { check: check({ actual_risk: 100 }), events: [{ trade_id: t.id, kind: "stop_moved", at: at(-40), old_value: 2395, new_value: 2390, planned: false }] });
    expect(r.tags.length).toBeGreaterThan(4);
    expect(r.questions).toEqual(r.tags.slice(0, 4).map((x) => x.question));
    expect(tagsOf(r).slice(0, 2)).toEqual(["fomo_entry", "revenge_trade"]);
  });

  it("the verdict only rises", () => {
    const order: Verdict[] = ["ok", "warn", "review", "violation", "cooldown"];
    for (const a of order) for (const b of order) expect(VERDICT_RANK[stricterVerdict(a, b)]).toBe(Math.max(VERDICT_RANK[a], VERDICT_RANK[b]));
  });

  it("reviewRow is the trade_reviews row", () => {
    const t = trade();
    const r = review(t);
    expect(reviewRow(t.id, r)).toMatchObject({
      trade_id: t.id, review_type: "single_trade", verdict: "ok", root_cause: "randomness", quadrant: "clean_loss", outcome: "loss",
      process_score: 100, quality_score: 100, findings: [...r.process, ...r.risk, ...r.execution], questions: r.questions,
    });
  });
});

describe("helpers", () => {
  it("realizedR, exitR, heatAtEntry and lossesBefore", () => {
    const t = trade({ exit_price: 2407.5, pnl: 75 });
    expect(realizedR(t)).toBe(1.5);
    expect(exitR(t)).toBe(1.5);
    expect(exitR({ ...t, direction: "short", initial_stop_loss: 2405, exit_price: 2390 })).toBe(2);
    expect(realizedR({ ...t, risk_amount: 0, risk_source: "unknown" })).toBeNull();
    const open: HistoryTrade = { id: "o", symbol: "XAUUSD", status: "open", pnl: null, risk_amount: 30, opened_at: at(-120), closed_at: null };
    const later: HistoryTrade = { ...open, id: "l", opened_at: at(-30) };
    expect(heatAtEntry(t, [t, open, later])).toBe(80);
    expect(lossesBefore(t, [t, closed(-10, -200), closed(5, -150), closed(-10, -100), closed(-10, -90), closed(-10, 30)])).toBe(2);
  });
});

describe("activeTempRules", () => {
  const MON_NIGHT = "2026-10-12T21:00:00+03:00";
  const rule = (duration: NextRule["duration"]): NextRule => ({ text: `قاعدة ${duration}`, duration, trigger: "none", reason: "" });
  const plans = [{ day: "2026-10-13", rules_today: [acceptRule(rule("next_two_trades"), new Date(MON_NIGHT)), acceptRule(rule("next_session"), new Date(MON_NIGHT)), acceptRule(rule("next_week"), new Date(MON_NIGHT)), "لا ذهب وقت الأخبار"] }];
  const open = (iso: string) => ({ opened_at: iso });
  const texts = (now: string, trades: { opened_at: string }[] = []) => activeTempRules(plans, trades, new Date(now), TZ).map((x) => `${x.text}${x.left != null ? `:${x.left}` : ""}`);

  it("a trade-count rule counts entries after it was accepted", () => {
    expect(texts("2026-10-13T12:00:00+03:00", [open("2026-10-12T10:00:00+03:00"), open("2026-10-13T10:00:00+03:00")])).toContain("قاعدة next_two_trades:1");
    expect(texts("2026-10-13T12:00:00+03:00", [open("2026-10-13T10:00:00+03:00"), open("2026-10-13T11:00:00+03:00")])).not.toContain("قاعدة next_two_trades:1");
    expect(texts("2026-10-12T22:00:00+03:00")).toContain("قاعدة next_two_trades:2"); // from the moment he accepts
  });

  it("next_session lasts through the next trading day, next_week 7 days, a plain line its own day", () => {
    expect(texts("2026-10-13T15:00:00+03:00")).toEqual(["قاعدة next_two_trades:2", "قاعدة next_session", "قاعدة next_week", "لا ذهب وقت الأخبار"]);
    expect(texts("2026-10-12T22:00:00+03:00")).not.toContain("لا ذهب وقت الأخبار"); // tomorrow's line isn't on yet
    expect(texts("2026-10-14T00:01:00+03:00")).toEqual(["قاعدة next_two_trades:2", "قاعدة next_week"]);
    expect(texts("2026-10-19T23:00:00+03:00")).toContain("قاعدة next_week");
    expect(texts("2026-10-20T00:01:00+03:00")).toEqual(["قاعدة next_two_trades:2"]);
  });

  it("a Friday-night session rule covers Monday; the latest acceptance of the same rule wins; junk is skipped", () => {
    const fri = [{ day: "2026-10-19", rules_today: [acceptRule(rule("next_session"), new Date("2026-10-16T22:00:00+03:00"))] }];
    expect(activeTempRules(fri, [], new Date("2026-10-19T15:00:00+03:00"), TZ)).toHaveLength(1);
    expect(activeTempRules(fri, [], new Date("2026-10-20T00:01:00+03:00"), TZ)).toEqual([]);
    const twice = [
      { day: "2026-10-12", rules_today: [acceptRule(rule("next_trade"), new Date("2026-10-12T09:00:00+03:00"))] },
      { day: "2026-10-13", rules_today: [acceptRule(rule("next_trade"), new Date(MON_NIGHT)), null, 7, { text: "" }, { note: "x" }] },
    ];
    expect(activeTempRules(twice, [open("2026-10-12T10:00:00+03:00")], new Date("2026-10-13T12:00:00+03:00"), TZ)).toEqual([
      { text: "قاعدة next_trade", left: 1, until: null },
    ]);
    expect(activeTempRules([{ day: "2026-10-13", rules_today: null }], [], new Date(NOW), TZ)).toEqual([]);
  });
});
