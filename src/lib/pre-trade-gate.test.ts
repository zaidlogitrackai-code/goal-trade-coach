import { describe, expect, it } from "vitest";
import { evaluateBreaker, type BreakerInput, type BreakerSettings, type BreakerTrade } from "./circuit-breaker";
import {
  aggregateDecisions, applyAiOpinion, DECISION_RANK, evaluatePreTrade, gateRow, inSessionHours, lastLoss, lastLossWithin,
  plannedRisk, unreviewedCloses,
  type Answers, type GateInput, type GatePlan, type GateSettings, type GateTicket, type GateTrade,
} from "./pre-trade-gate";
import { riskUsd } from "./trade-idea";
import { protectProfit } from "./trading-status";
import type { Database } from "@/integrations/supabase/types";

// The gate takes the rows exactly as Supabase returns them (fails tsc if a column changes).
type Tables = Database["public"]["Tables"];
export const rowsFit = (s: Tables["trading_settings"]["Row"], p: Tables["daily_plans"]["Row"], t: Tables["trades"]["Row"]) =>
  [s, p, t] satisfies [GateSettings, GatePlan, GateTrade];

const TZ = "Asia/Riyadh";
const NOW = "2026-10-14T15:00:00+03:00"; // Wednesday
const SINCE = "2026-10-01T00:00:00+03:00";
const ago = (min: number) => new Date(Date.parse(NOW) - min * 60_000).toISOString();

let seq = 0;
function close(pnl: number | null, at: string): BreakerTrade {
  seq++;
  return {
    id: `t${seq}`, symbol: "EURUSD", direction: "long", entry_price: 1 + seq / 100, exit_price: null,
    status: "closed", pnl, opened_at: new Date(Date.parse(at) - 10 * 60_000).toISOString(), closed_at: at, created_at: at,
  };
}

// A $200 daily stop on 10,000; two losses in a row → 24h.
const BSET: BreakerSettings = {
  max_daily_loss: 200, weekly_max_loss: 0, monthly_max_loss: 0, limits_pct: null,
  max_consecutive_losses: 2, streak_cooldown_hours: 24, trading_paused: false, cooldown_until: null,
};
const breaker = (trades: BreakerTrade[] = [], over: Partial<BreakerInput> = {}) =>
  evaluateBreaker({
    settings: BSET, startBalance: 10_000, balance: 10_000, trades,
    limitsAcceptedAt: SINCE, breakerSince: SINCE, pausedUntil: null, tz: TZ, now: new Date(NOW), ...over,
  });
const ALLOWED = breaker();

const YES: Answers = { in_written_plan: true, stop_predefined: true, size_within_plan: true, not_revenge: true };
// EURUSD 0.1 lot with a 50-pip stop = $50, exactly the $50 per-trade limit.
const TICKET: GateTicket = { symbol: "EURUSD", direction: "long", entry: 1.085, stop: 1.08, targets: [1.095], lots: 0.1, emotion: "هادئ" };
const SETTINGS: GateSettings = { max_risk_per_trade: 50, cooldown_minutes: 15, session_start: null, session_end: null, timezone: TZ, reviews_since: null };
const PLAN: GatePlan = { no_trading: false, risk_per_trade: null };

const input = (over: Partial<GateInput> = {}, ticket: Partial<GateTicket> = {}): GateInput => ({
  intent: "pre_entry", ticket: { ...TICKET, ...ticket }, answers: YES, breaker: ALLOWED,
  settings: SETTINGS, plan: PLAN, trades: [], now: new Date(NOW), ...over,
});
const run = (over: Partial<GateInput> = {}, ticket: Partial<GateTicket> = {}) => evaluatePreTrade(input(over, ticket));
const codes = (r: ReturnType<typeof run>) => r.reasons.map((x) => x.code);

describe("the decision", () => {
  it("all pass → GO, with the stop, size and revenge answers computed", () => {
    const r = run();
    expect(r.decision).toBe("GO");
    expect(r.reasons).toEqual([]);
    expect(r).toMatchObject({ plannedRisk: 50, actualRisk: 50, maxLots: 0.1, upstream: "TRADING_ALLOWED", inRevengeWindow: false });
    expect(r.computed).toEqual(["stop_predefined", "size_within_plan", "not_revenge"]);
    // Only the plan question is his to answer when the numbers and the day are clean.
    expect(run({ answers: { in_written_plan: true } }).decision).toBe("GO");
  });

  it("an explicit «لا» on the plan, a missing stop or a size over the plan → NO_GO", () => {
    expect(run({ answers: { ...YES, in_written_plan: false } })).toMatchObject({ decision: "NO_GO", reasons: [{ code: "not_in_plan" }] });
    const noStop = run({}, { stop: null });
    expect(noStop.decision).toBe("NO_GO");
    expect(codes(noStop)).toEqual(["no_stop"]);
    expect(noStop.answers.stop_predefined).toBe(false);
    // His own «لا» wins over the computed «yes».
    expect(run({ answers: { ...YES, size_within_plan: false } })).toMatchObject({ decision: "NO_GO", reasons: [{ code: "size_over_plan" }] });
    expect(run({ answers: { ...YES, not_revenge: false } })).toMatchObject({ decision: "NO_GO", reasons: [{ code: "revenge_declared" }] });
  });

  it("actual risk above the planned → NO_GO, with the right size", () => {
    const r = run({}, { lots: 0.2 });
    expect(r.decision).toBe("NO_GO");
    expect(codes(r)).toEqual(["risk_over_plan"]);
    expect(r.reasons[0]!.text).toBe("مخاطرتك 100$ أكبر من المخططة 50$، الحجم الصح 0.1 لوت.");
    expect(r.answers.size_within_plan).toBe(false);
    // A typed amount can only make it stricter, never hide what the lots risk.
    expect(run({}, { typedRisk: 30, lots: 0.2 }).actualRisk).toBe(100);
    expect(run({}, { typedRisk: 80 })).toMatchObject({ actualRisk: 80, decision: "NO_GO" });
  });

  it("EURUSD 1 lot with a 50-pip stop risks $500", () => {
    expect(riskUsd("EURUSD", 1.085, 1.08, 1)).toBe(500);
    expect(run({}, { lots: 1 })).toMatchObject({ actualRisk: 500, maxLots: 0.1, decision: "NO_GO" });
  });

  it("a risk that can't be computed → REVIEW, never a safe 0", () => {
    const r = run({}, { lots: null });
    expect(r.decision).toBe("REVIEW_REQUIRED");
    expect(codes(r)).toEqual(["risk_unknown"]);
    expect(r.reasons[0]!.text).toBe("ما قدرت أحسب مخاطرة الصفقة (ناقص الحجم).");
    expect(r.actualRisk).toBeNull();
    // A typed amount is enough to judge it.
    expect(run({}, { lots: null, typedRisk: 40 })).toMatchObject({ decision: "GO", actualRisk: 40 });
  });

  it("levels that contradict each other → NO_GO", () => {
    const r = run({}, { stop: 1.09 });
    expect(r.decision).toBe("NO_GO");
    expect(codes(r)).toEqual(["bad_levels"]);
    expect(r.actualRisk).toBeNull();
  });

  it("NO_GO outranks REVIEW, and every reason is kept, strictest first", () => {
    const r = run({ plan: null }, { stop: null });
    expect(r.decision).toBe("NO_GO");
    expect(codes(r)).toEqual(["no_stop", "no_plan"]);
    expect(DECISION_RANK.NO_GO).toBeGreaterThan(DECISION_RANK.REVIEW_REQUIRED);
  });

  it("a blank answer on a pre-entry ticket → REVIEW, not NO_GO (owner decision 5)", () => {
    const r = run({ answers: { ...YES, in_written_plan: null } });
    expect(r.decision).toBe("REVIEW_REQUIRED");
    expect(r.reasons).toEqual([{ code: "unanswered", decision: "REVIEW_REQUIRED", text: "ما جاوبت: الصفقة من خطتك المكتوبة؟" }]);
  });

  it("no written plan → REVIEW; a rest day → NO_GO", () => {
    expect(run({ plan: null })).toMatchObject({ decision: "REVIEW_REQUIRED", reasons: [{ code: "no_plan", text: "ما في خطة مكتوبة لليوم." }] });
    expect(run({ plan: { no_trading: true } })).toMatchObject({ decision: "NO_GO", reasons: [{ code: "rest_day" }] });
  });

  it("missing settings or an unknown breaker → REVIEW", () => {
    const r = run({ settings: null });
    expect(r.decision).toBe("REVIEW_REQUIRED");
    expect(codes(r)).toEqual(["no_settings"]);
    expect(r.revengeWindowMin).toBe(30);
    expect(run({ breaker: null })).toMatchObject({ decision: "REVIEW_REQUIRED", reasons: [{ code: "breaker_unknown" }] });
  });

  it("history and the analyst's watch cards → NO_ACTIONABLE, only journaled", () => {
    for (const intent of ["historical", "watch"] as const) {
      const r = run({ intent, breaker: breaker([close(-200, "2026-10-14T10:00:00+03:00")]), answers: null }, { stop: null });
      expect(r.decision).toBe("NO_ACTIONABLE");
      expect(codes(r)).toEqual(["not_actionable"]);
    }
  });
});

describe("the upstream breaker", () => {
  it("HALTED, COOLDOWN and PARTIAL → NO_GO; PARTIAL is HALTED", () => {
    const halted = run({ breaker: breaker([close(-200, "2026-10-14T10:00:00+03:00")]) });
    expect(halted).toMatchObject({ decision: "NO_GO", upstream: "HALTED", reasons: [{ code: "breaker" }] });
    expect(halted.reasons[0]!.text).toContain("التداول موقوف: خسارة اليوم 200$ وصلت حدّك 200$.");
    expect(halted.reasons[0]!.text).toContain("يرجع التداول الخميس 15/10 00:00.");

    const cooldown = run({ breaker: breaker([close(-20, "2026-10-14T09:00:00+03:00"), close(-20, "2026-10-14T10:00:00+03:00")]) });
    expect(cooldown).toMatchObject({ decision: "NO_GO", upstream: "COOLDOWN" });

    const partial = run({ breaker: breaker([close(null, "2026-10-14T10:00:00+03:00")]) });
    expect(partial).toMatchObject({ decision: "NO_GO", upstream: "PARTIAL", reasons: [{ code: "breaker" }] });
    expect(partial.reasons[0]!.text).toContain("بيانات ناقصة");
  });

  it("before breaker_since (preview) a stop only asks for a review", () => {
    const r = run({ breaker: breaker([close(-200, "2026-10-14T10:00:00+03:00")], { breakerSince: null }) });
    expect(r).toMatchObject({ decision: "REVIEW_REQUIRED", upstream: "HALTED", reasons: [{ code: "breaker" }] });
    expect(r.reasons[0]!.text).toContain("معاينة");
  });

  it("max trades or the profit cap reached → REVIEW «احمِ ربحك», not a breaker state", () => {
    const protect = protectProfit({ tradesToday: 3, todayPnl: 40 }, { max_trades_per_day: 3, max_daily_profit: 0 });
    const r = run({ protect });
    expect(r.decision).toBe("REVIEW_REQUIRED");
    expect(r.upstream).toBe("TRADING_ALLOWED");
    expect(r.reasons[0]).toMatchObject({ code: "protect_profit", text: "وصلت حدّ صفقاتك اليوم. احمِ ربحك، لا تزيد صفقات." });
  });

  it("warns when every open stop plus this one would pass today's stop", () => {
    const b = breaker([close(-120, "2026-10-14T10:00:00+03:00")]); // 80 left of 200
    const r = run({ breaker: b, openRisk: 50 });
    expect(r.decision).toBe("GO");
    expect(r.warnings).toEqual([{ code: "heat", text: "لو ضربت كل الوقوف بتخسر 100$، وباقي لك 80$ قبل إيقاف اليوم." }]);
    expect(run({ breaker: b, openRisk: 0 }).warnings).toEqual([]);
    // Once stopped, the breaker's reason says it; no heat line on top.
    expect(run({ breaker: breaker([close(-200, "2026-10-14T10:00:00+03:00")]), openRisk: 50 }).warnings).toEqual([]);
  });
});

describe("the revenge window", () => {
  it("a loss 29 minutes ago with cooldown_minutes=15 → NO_GO (the window is never under 30)", () => {
    const r = run({ trades: [close(-30, ago(29))] });
    expect(r).toMatchObject({ decision: "NO_GO", inRevengeWindow: true, revengeWindowMin: 30 });
    expect(r.reasons[0]).toMatchObject({ code: "revenge_window", text: "خسرت قبل 29 دقيقة، ونافذة الانتقام 30 دقيقة. لا تدخل صفقة تعويض." });
    expect(r.answers.not_revenge).toBe(false);
    expect(run({ trades: [close(-30, ago(31))] }).decision).toBe("GO");
    // A longer own cooldown widens it.
    expect(run({ trades: [close(-30, ago(40))], settings: { ...SETTINGS, cooldown_minutes: 45 } }).decision).toBe("NO_GO");
  });

  it("a partial-trim loss 10 minutes ago → NO_GO", () => {
    const r = run({ partialEvents: [{ trade_id: "open1", kind: "partial_close", realized_pnl: -20, at: ago(10) }] });
    expect(r.decision).toBe("NO_GO");
    expect(r.lastLoss).toMatchObject({ tradeId: "open1", trim: true, minutesAgo: 10 });
    expect(r.reasons[0]!.text).toBe("خسرت قبل 10 دقايق، ونافذة الانتقام 30 دقيقة. لا تدخل صفقة تعويض.");
  });

  it("a win after the loss doesn't reopen it, a future close is ignored", () => {
    const trades = [close(-30, ago(20)), close(25, ago(5)), close(-10, new Date(Date.parse(NOW) + 60_000).toISOString())];
    expect(lastLoss(trades, [], new Date(NOW))).toMatchObject({ pnl: -30, minutesAgo: 20 });
    expect(lastLossWithin(trades, [], 30, new Date(NOW))).not.toBeNull();
    expect(lastLossWithin(trades, [], 15, new Date(NOW))).toBeNull();
  });

  it("a placed trade is judged at its entry time", () => {
    const trades = [close(-30, ago(60))];
    // Entered 50 minutes ago, 10 minutes after that loss.
    const r = run({ intent: "already_placed", trades, answers: null }, { openedAt: ago(50) });
    expect(r.inRevengeWindow).toBe(true);
    expect(r.decision).toBe("NO_GO");
    expect(r.reasons[0]!.text).toBe("دخلت بعد 10 دقايق من خسارة، داخل نافذة الانتقام (30 دقيقة).");
    expect(r.lastLoss?.minutesAgo).toBe(10);
    expect(run({ trades }).inRevengeWindow).toBe(false);
  });

  it("a sensitive emotion leaves the revenge question to him, with a warning", () => {
    const r = run({ answers: { ...YES, not_revenge: null } }, { emotion: "متوتر" });
    expect(r.decision).toBe("REVIEW_REQUIRED");
    expect(r.reasons[0]!.text).toBe("ما جاوبت: مو صفقة تعويض؟");
    expect(r.warnings.map((w) => w.code)).toEqual(["emotion"]);
  });
});

describe("reviews, session hours and temporary rules", () => {
  const SINCE_REVIEWS = "2026-10-10T00:00:00+03:00";
  const old = close(-20, "2026-10-09T12:00:00+03:00");
  const recent = close(15, "2026-10-13T12:00:00+03:00");

  it("an unreviewed close before reviews_since → GO; after it → REVIEW until reviewed", () => {
    const settings = { ...SETTINGS, reviews_since: SINCE_REVIEWS };
    expect(run({ settings, trades: [old] }).decision).toBe("GO");
    const r = run({ settings, trades: [old, recent] });
    expect(r).toMatchObject({ decision: "REVIEW_REQUIRED", reasons: [{ code: "unreviewed" }] });
    expect(run({ settings, trades: [old, recent], reviewedTradeIds: [recent.id] }).decision).toBe("GO");
    // reviews_since null switches the rule off.
    expect(run({ trades: [old, recent] }).decision).toBe("GO");
    expect(unreviewedCloses([old, recent], [], SINCE_REVIEWS, new Date(NOW))).toEqual([recent]);
  });

  it("outside his session hours → REVIEW, only when both are set", () => {
    const settings = { ...SETTINGS, session_start: "08:00:00", session_end: "14:00:00" };
    expect(run({ settings })).toMatchObject({ decision: "REVIEW_REQUIRED", reasons: [{ code: "outside_session", text: "برّا ساعات جلستك (08:00–14:00)." }] });
    expect(run({ settings: { ...settings, session_end: "16:00" } }).decision).toBe("GO");
    expect(run({ settings: { ...settings, session_end: null } }).decision).toBe("GO");
    // An overnight session wraps midnight, on his clock.
    expect(inSessionHours(new Date("2026-10-14T23:30:00+03:00"), "22:00", "02:00", TZ)).toBe(true);
    expect(inSessionHours(new Date("2026-10-14T15:00:00+03:00"), "22:00", "02:00", TZ)).toBe(false);
  });

  it("temporary rules only warn", () => {
    const r = run({ tempRules: [{ text: "مخاطرة نص حدك لصفقتين", left: 1 }] });
    expect(r.decision).toBe("GO");
    expect(r.warnings).toEqual([{ code: "temp_rule", text: "قاعدة مؤقتة: مخاطرة نص حدك لصفقتين — باقي 1" }]);
  });
});

describe("planned risk, AI opinion and aggregation", () => {
  it("planned risk is today's plan, never looser than the per-trade limit", () => {
    expect(plannedRisk({ max_risk_per_trade: 50 }, { risk_per_trade: 30 })).toBe(30);
    expect(plannedRisk({ max_risk_per_trade: 50 }, { risk_per_trade: 80 })).toBe(50);
    expect(plannedRisk({ max_risk_per_trade: 0 }, { risk_per_trade: 30 })).toBe(30);
    expect(plannedRisk({ max_risk_per_trade: 0 }, null)).toBeNull();
    // With no planned number the size is his answer to give.
    const r = run({ settings: { ...SETTINGS, max_risk_per_trade: 0 }, answers: { ...YES, size_within_plan: null } });
    expect(r).toMatchObject({ plannedRisk: null, maxLots: null, decision: "REVIEW_REQUIRED" });
    expect(r.computed).not.toContain("size_within_plan");
  });

  it("applyAiOpinion raises GO to a review and never lowers", () => {
    const go = run();
    const raised = applyAiOpinion(go, { plan_match: "mismatch", missing: ["كسر الهيكل"] });
    expect(raised.decision).toBe("REVIEW_REQUIRED");
    expect(raised.reasons).toEqual([{ code: "ai_mismatch", decision: "REVIEW_REQUIRED", text: "سَنَد شايف إن شرط «كسر الهيكل» ناقص." }]);
    expect(applyAiOpinion(go, { plan_match: "unclear", missing: ["x"] })).toBe(go);
    expect(applyAiOpinion(go, { plan_match: "match" })).toBe(go);

    const noGo = run({}, { stop: null });
    expect(applyAiOpinion(noGo, { plan_match: "mismatch" }).decision).toBe("NO_GO");
    expect(applyAiOpinion(noGo, { plan_match: "match" }).decision).toBe("NO_GO");
    const history = run({ intent: "historical" });
    expect(applyAiOpinion(history, { plan_match: "mismatch" })).toBe(history);
  });

  it("aggregates to the strictest actionable decision", () => {
    expect(aggregateDecisions(["GO", "REVIEW_REQUIRED", "NO_GO"])).toBe("NO_GO");
    expect(aggregateDecisions(["GO", "NO_ACTIONABLE"])).toBe("GO");
    expect(aggregateDecisions(["NO_ACTIONABLE"])).toBe("NO_ACTIONABLE");
    expect(aggregateDecisions([])).toBeNull();
  });
});

describe("the journal row", () => {
  it("an AI-logged placed trade is journaled with answers=null and its decision", () => {
    const i = input({ intent: "already_placed", answers: null }, { openedAt: ago(5) });
    const r = evaluatePreTrade(i);
    expect(r.decision).toBe("REVIEW_REQUIRED");
    expect(r.reasons[0]!.text).toBe("ما جاوبت: الصفقة من خطتك المكتوبة؟ حطيت الوقف قبل الدخول؟");
    const row = gateRow(i, r, "ai") satisfies Omit<Tables["pre_trade_checks"]["Insert"], "user_id">;
    expect(row).toEqual({
      source: "ai", intent: "already_placed", symbol: "EURUSD", direction: "long", decision: "REVIEW_REQUIRED",
      reasons: r.reasons, answers: null, planned_risk: 50, actual_risk: 50, max_lots: 0.1, position_size: 0.1,
      upstream: "TRADING_ALLOWED", minutes_since_loss: null,
    });
  });

  it("keeps only the answers he gave and the minutes since the last loss", () => {
    const i = input({ answers: { in_written_plan: true, not_revenge: null }, trades: [close(-30, ago(90))] });
    const row = gateRow(i, evaluatePreTrade(i), "form");
    expect(row).toMatchObject({ source: "form", decision: "GO", answers: { in_written_plan: true }, minutes_since_loss: 90 });
  });
});
