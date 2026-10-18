import { describe, expect, it } from "vitest";
import {
  patternsForPrompt, periodBounds, periodLabel, periodOf, periodReview, periodRow, shiftPeriod,
  type PatternAnalysis, type PatternCheck, type PatternReview, type PatternRule, type PatternTrade, type PatternViolation,
  type Period, type PeriodInput, type PeriodReview,
} from "./patterns";
import type { TagCode, Verdict } from "./trade-review";
import { addDays } from "./trading-day";
import type { Database } from "@/integrations/supabase/types";

// The review takes the rows exactly as Supabase returns them (fails tsc if a column changes).
type Tables = Database["public"]["Tables"];
export const rowsFit = (
  r: Tables["trade_reviews"]["Row"], t: Tables["trades"]["Row"], v: Tables["rule_violations"]["Row"],
  ru: Tables["trading_rules"]["Row"], c: Tables["pre_trade_checks"]["Row"], a: Tables["chart_analyses"]["Row"],
) => [r, t, v, ru, c, a] satisfies [PatternReview, PatternTrade, PatternViolation, PatternRule, PatternCheck, PatternAnalysis];

const TZ = "Asia/Riyadh";
const W42: Period = { kind: "week", key: "2026-W42" }; // Mon 12/10 – Sun 18/10
const OCT: Period = { kind: "month", key: "2026-10" };
const NOW = new Date("2026-11-02T09:00:00+03:00"); // after both
/** An instant on the Riyadh clock. */
const riy = (day: string, hm = "12:00") => new Date(`${day}T${hm}:00+03:00`).toISOString();

let seq = 0;
function trade(day: string, pnl: number | null, over: Partial<PatternTrade> = {}): PatternTrade {
  seq++;
  return {
    id: `t${seq}`, status: "closed", pnl, symbol: "XAUUSD", direction: "long",
    opened_at: riy(day, "10:00"), closed_at: riy(day, "11:00"), pre_trade_check_id: null, ...over,
  };
}
function review(t: PatternTrade, verdict: Verdict, tags: TagCode[] = ["no_pattern_detected"], over: Partial<PatternReview> = {}): PatternReview {
  return {
    trade_id: t.id, review_type: "single_trade", period_key: null, verdict,
    tags: tags.map((tag) => ({ tag, confidence: "medium", evidence: "…", question: "…" })),
    process_score: 100, risk_score: 100, execution_score: 100, quality_score: 100,
    next_rules: [], decision: "journal_only", created_at: t.closed_at ?? t.opened_at, ...over,
  };
}
type Row = [PatternTrade, PatternReview | null];
const rt = (day: string, pnl: number | null, verdict: Verdict | null, tags?: TagCode[], over: Partial<PatternTrade> = {}): Row => {
  const t = trade(day, pnl, over);
  return [t, verdict ? review(t, verdict, tags) : null];
};
const book = (rows: Row[]) => ({ trades: rows.map((r) => r[0]), reviews: rows.flatMap((r) => (r[1] ? [r[1]] : [])) });
const run = (over: Partial<PeriodInput>) => periodReview({ period: W42, tz: TZ, reviews: [], trades: [], now: NOW, ...over });
const tagOf = (r: PeriodReview, tag: TagCode) => r.tagCounts.find((x) => x.tag === tag);

describe("periods on the trader's calendar", () => {
  it("a Monday week and a month in Riyadh", () => {
    expect(periodBounds(W42, TZ)).toEqual({ from: new Date("2026-10-11T21:00:00Z"), to: new Date("2026-10-18T21:00:00Z") });
    expect(periodBounds(OCT, TZ)).toEqual({ from: new Date("2026-09-30T21:00:00Z"), to: new Date("2026-10-31T21:00:00Z") });
    expect(periodLabel(W42)).toBe("أسبوع 12/10–16/10");
    expect(periodLabel(OCT)).toBe("أكتوبر 2026");
  });

  it("an instant's period follows the zone, not UTC", () => {
    expect(periodOf("month", "2026-09-30T21:30:00Z", TZ).key).toBe("2026-10");
    expect(periodOf("month", "2026-09-30T21:30:00Z", "UTC").key).toBe("2026-09");
    expect(periodOf("week", "2026-10-18T21:30:00Z", TZ).key).toBe("2026-W43"); // Monday 00:30
  });

  it("shifts across years, ISO week 53 included", () => {
    expect(shiftPeriod({ kind: "week", key: "2026-W01" }, -1)?.key).toBe("2025-W52");
    expect(shiftPeriod({ kind: "week", key: "2026-W52" }, 1)?.key).toBe("2026-W53");
    expect(shiftPeriod({ kind: "week", key: "2026-W53" }, 1)?.key).toBe("2027-W01");
    expect(shiftPeriod({ kind: "month", key: "2026-01" }, -1)?.key).toBe("2025-12");
    expect(shiftPeriod({ kind: "month", key: "2026-12" }, 1)?.key).toBe("2027-01");
  });

  it("rejects a key that isn't a real week or month", () => {
    expect(periodBounds({ kind: "week", key: "2025-W53" }, TZ)).toBeNull();
    expect(periodBounds({ kind: "week", key: "2026-W00" }, TZ)).toBeNull();
    expect(periodBounds({ kind: "month", key: "2026-13" }, TZ)).toBeNull();
    expect(() => run({ period: { kind: "week", key: "2026-42" } })).toThrow(RangeError);
  });

  it("month boundaries in Riyadh: a close at 00:00 on the 1st is the new month", () => {
    const sep30 = trade("2026-09-30", 10, { closed_at: "2026-09-30T20:59:00Z" }); // 23:59 Riyadh
    const oct1 = trade("2026-10-01", 20, { closed_at: "2026-09-30T21:00:00Z" }); // 00:00 Riyadh
    const oct31 = trade("2026-10-31", 40, { closed_at: "2026-10-31T20:59:00Z" });
    const nov1 = trade("2026-11-01", 80, { closed_at: "2026-10-31T21:00:00Z" });
    const trades = [sep30, oct1, oct31, nov1];
    expect(run({ period: OCT, trades })).toMatchObject({ trades: 2, pnl: 60 });
    expect(run({ period: { kind: "month", key: "2026-09" }, trades })).toMatchObject({ trades: 1, pnl: 10 });
    // In UTC the same rows fall into other months: the zone decides.
    expect(run({ period: OCT, trades, tz: "UTC" })).toMatchObject({ trades: 2, pnl: 120 });
  });
});

describe("patterns", () => {
  it("3 revenge tags in a week → rule drift, a review verdict and a next-week rule", () => {
    const r = run(book([
      rt("2026-10-12", -40, "review", ["revenge_trade"]),
      rt("2026-10-13", -30, "review", ["revenge_trade"]),
      rt("2026-10-14", 20, "review", ["revenge_trade", "fomo_entry"]),
      rt("2026-10-15", 50, "ok"),
    ]));
    expect(r.ruleDrift).toEqual(["revenge_trade"]);
    expect(r.recurring).toEqual(["revenge_trade"]);
    expect(r.tagCounts[0]).toMatchObject({ tag: "revenge_trade", count: 3, label: "صفقة تعويض" });
    expect(r.verdict).toBe("review");
    expect(r.reasons).toContain("«صفقة تعويض» تكرر 3 مرات هالأسبوع.");
    expect(r.nextRules[0]).toMatchObject({ trigger: "revenge_trade", duration: "next_week" });
    expect(r.nextRules.length).toBeLessThanOrEqual(2);
  });

  it("two of a tag recur without drifting; missing sizes recur but never drift", () => {
    const r = run(book([
      rt("2026-10-12", -40, "ok", ["fomo_entry", "unknown_size"]),
      rt("2026-10-13", -30, "ok", ["fomo_entry", "unknown_size"]),
      rt("2026-10-14", 20, "warn", ["unknown_size"]),
    ]));
    expect(r.recurring).toEqual(["unknown_size", "fomo_entry"]);
    expect(r.ruleDrift).toEqual([]);
    expect(r.verdict).toBe("warn");
    // Behaviour first; the data gap only asks for the numbers.
    expect(r.nextRules.map((x) => x.trigger)).toEqual(["fomo_entry", "unknown_size"]);
  });

  it("the clean/dirty P&L split, clean losses and lucky wins", () => {
    const r = run(book([
      rt("2026-10-12", 100, "ok"),
      rt("2026-10-12", -50, "warn"),
      rt("2026-10-13", 80, "violation", ["size_creep"]),
      rt("2026-10-14", -200, "cooldown", ["revenge_trade"]),
      rt("2026-10-15", -30, "review", ["stop_moved"]),
      rt("2026-10-16", 30, null),
    ]));
    expect(r).toMatchObject({ trades: 6, reviewed: 5, unreviewed: 1, wins: 3, losses: 3, pnl: -70, cleanLosses: 1, luckyWins: 1 });
    expect(r.processPnl).toEqual({ clean: 50, dirty: -150, unreviewed: 30, cleanTrades: 2, dirtyTrades: 3, unreviewedTrades: 1 });
    expect(r.quadrants).toEqual({ clean_win: 1, clean_loss: 1, lucky_win: 1, dirty_loss: 2 });
    // Two violation verdicts in one week: the period is a cooldown.
    expect(r.verdict).toBe("cooldown");
    expect(r.violationCount).toBe(2);
  });

  it("averages the stored scores and finds the longest losing run (break-even is a win)", () => {
    const rows = [
      rt("2026-10-12", -10, "ok"), rt("2026-10-12", -10, "ok"), rt("2026-10-13", 0, "ok"),
      rt("2026-10-13", -10, null), rt("2026-10-14", null, null), rt("2026-10-14", -10, null), rt("2026-10-15", -10, null),
      rt("2026-10-16", 5, null),
    ];
    rows[0]![1]!.process_score = 70;
    rows[1]![1]!.process_score = 85;
    rows[1]![1]!.quality_score = 40;
    rows[2]![1]!.quality_score = null;
    const r = run(book(rows));
    expect(r.maxLosingStreak).toBe(3);
    expect(r.avgScores).toEqual({ process: 85, risk: 100, execution: 100, quality: 70 });
  });

  it("trend arrows across 3 weeks; a week with no trades proves nothing", () => {
    const rows: Row[] = [];
    const week = (monday: string, tags: TagCode[]) => tags.forEach((tag, i) => rows.push(rt(addDays(monday, i % 5), -10, "review", [tag])));
    week("2026-09-28", ["revenge_trade", "fomo_entry", "fomo_entry", "hesitation"]); // W40
    week("2026-10-05", ["revenge_trade", "fomo_entry", "fomo_entry", "hesitation"]); // W41
    week("2026-10-12", ["revenge_trade", "revenge_trade", "revenge_trade", "hesitation"]); // W42; W39 is empty
    const data = book(rows);

    const w42 = run(data);
    expect(w42.baselinePeriods).toBe(2);
    expect(tagOf(w42, "revenge_trade")).toMatchObject({ count: 3, prevAvg: 1, trend: "up" });
    expect(tagOf(w42, "hesitation")).toMatchObject({ count: 1, prevAvg: 1, trend: "flat" });
    // Gone this week: still listed, so the drop shows.
    expect(tagOf(w42, "fomo_entry")).toMatchObject({ count: 0, prevAvg: 2, trend: "down", tradeIds: [] });
    expect(w42.tagCounts.map((x) => x.tag)).toEqual(["revenge_trade", "hesitation", "fomo_entry"]);

    const w41 = run({ ...data, period: { kind: "week", key: "2026-W41" } });
    expect(w41.baselinePeriods).toBe(1);
    expect(tagOf(w41, "revenge_trade")).toMatchObject({ count: 1, trend: "flat" });

    const w40 = run({ ...data, period: { kind: "week", key: "2026-W40" } });
    expect(w40.baselinePeriods).toBe(0);
    expect(tagOf(w40, "fomo_entry")).toMatchObject({ count: 2, prevAvg: null, trend: null });
  });
});

describe("violations", () => {
  const v = (day: string, over: Partial<PatternViolation> = {}): PatternViolation => ({ id: `v${++seq}`, source: "manual", rule_id: null, trade_id: null, occurred_at: riy(day), ...over });

  it("2 violations within 7 days → cooldown, with the half-risk rule first", () => {
    const r = run({ period: OCT, violations: [v("2026-10-05"), v("2026-10-09")] });
    expect(r).toMatchObject({ verdict: "cooldown", violationCount: 2 });
    expect(r.nextRules[0]).toMatchObject({ trigger: "cooldown", duration: "next_month", text: expect.stringContaining("0.5R") });
  });

  it("2 violations further apart are a violation month, not a cooldown", () => {
    expect(run({ period: OCT, violations: [v("2026-10-05"), v("2026-10-20")] }).verdict).toBe("violation");
  });

  it("one mistake counts once: the gate row, the NO_GO entry and the trade's verdict", () => {
    const [t, rev] = rt("2026-10-13", -50, "violation", ["fomo_entry"], { pre_trade_check_id: "c1" });
    const check: PatternCheck = { id: "c1", created_at: riy("2026-10-13", "09:59"), intent: "pre_entry", decision: "NO_GO", proceeded: true, trade_id: null };
    const r = run({
      trades: [t], reviews: [rev!], checks: [check],
      violations: [v("2026-10-13", { source: "gate", pre_trade_check_id: "c1" }), v("2026-10-13", { source: "manual", trade_id: t.id })],
    });
    expect(r).toMatchObject({ verdict: "violation", violationCount: 1 });
    expect(r.enteredOnNoGo).toEqual({ count: 1, pnl: -50, tradeIds: [t.id] });
  });

  it("violations by rule, split by source", () => {
    const rules: PatternRule[] = [{ id: "r1", title: "لا تداول وقت الأخبار" }];
    const r = run({
      rules,
      violations: [
        v("2026-10-12", { rule_id: "r1" }), v("2026-10-13", { rule_id: "r1" }), v("2026-10-14", { rule_id: "r1", source: "ai" }),
        v("2026-10-14", { source: "gate" }), v("2026-10-15", { source: "gate" }), v("2026-10-15", { source: "breaker" }),
        v("2026-10-16", { rule_id: "r-gone" }), v("2026-10-05", { rule_id: "r1" }), // last week: not counted
      ],
    });
    expect(r.violationsByRule[0]).toEqual({ key: "rule:r1", ruleId: "r1", label: "لا تداول وقت الأخبار", count: 3, bySource: { manual: 2, ai: 1 } });
    expect(r.violationsByRule[1]).toMatchObject({ key: "source:gate", ruleId: null, label: "دخول رغم «لا تدخل»", count: 2, bySource: { gate: 2 } });
    expect(r.violationsByRule.find((x) => x.ruleId === "r-gone")).toMatchObject({ label: "قاعدة محذوفة", count: 1 });
    expect(r.violationsBySource).toEqual({ manual: 3, ai: 1, gate: 2, breaker: 1 });
  });
});

describe("the gate and the analyst", () => {
  const c = (day: string, over: Partial<PatternCheck>): PatternCheck => ({
    id: `c${++seq}`, created_at: riy(day, "09:00"), intent: "pre_entry", decision: "NO_GO", proceeded: false,
    planned_risk: 50, actual_risk: null, symbol: "XAUUSD", direction: "long", trade_id: null, ...over,
  });

  it("gateSaved counts only NO_GO checks with proceeded=false", () => {
    const took = trade("2026-10-13", -50);
    const linked = c("2026-10-15", { proceeded: false });
    const quiet = trade("2026-10-15", 30, { pre_trade_check_id: linked.id! });
    const r = run({
      trades: [took, quiet],
      checks: [
        c("2026-10-12", { actual_risk: 60 }), // saved 60
        c("2026-10-12", { actual_risk: null, planned_risk: 40 }), // saved 40
        c("2026-10-13", { proceeded: true, trade_id: took.id }),
        c("2026-10-13", { proceeded: null }),
        c("2026-10-14", { decision: "GO" }),
        c("2026-10-14", { intent: "historical" }),
        c("2026-10-07", {}), // last week
        linked, // a trade came of it anyway: an entry, not a save
      ],
    });
    expect(r.gateSaved).toEqual({ count: 2, risk: 100 });
    expect(r.enteredOnNoGo).toMatchObject({ count: 2, pnl: -20 });
    expect(r.enteredOnNoGo.tradeIds.sort()).toEqual([took.id, quiet.id].sort());
  });

  it("watch checks are counted; one he took later is not 'not taken'", () => {
    const watch = (day: string, symbol: string, direction: string, over: Partial<PatternCheck> = {}) =>
      c(day, { intent: "watch", decision: "NO_ACTIONABLE", proceeded: null, symbol, direction, ...over });
    const r = run({
      trades: [
        trade("2026-10-13", 10, { symbol: "EURUSD", direction: "short", opened_at: riy("2026-10-13", "14:00") }),
        trade("2026-10-14", 10, { symbol: "US500", direction: "short", opened_at: riy("2026-10-14", "14:00") }),
      ],
      checks: [
        watch("2026-10-12", "XAUUSD", "long"),
        watch("2026-10-13", "EURUSD", "sell"), // taken at 14:00
        watch("2026-10-14", "US500", "buy"), // the trade went the other way
        watch("2026-10-15", "XAUUSD", "long", { trade_id: "t-linked" }),
        watch("2026-10-07", "USOIL", "long"), // last week
      ],
    });
    expect(r.watchedNotTaken).toEqual({ count: 2, taken: 2, symbols: ["XAUUSD", "US500"] });
  });

  it("the analyst's hit-rate by confidence, on trades taken in the card's direction", () => {
    const [t1, t2, t3, t4, t5, t6] = [
      trade("2026-10-12", 50), trade("2026-10-12", -50), trade("2026-10-13", 20, { direction: "short" }),
      trade("2026-10-13", 30), trade("2026-10-14", 10), trade("2026-10-15", 40),
    ];
    const a = (t: PatternTrade | null, card: unknown, at = "2026-10-12"): PatternAnalysis => ({ created_at: riy(at, "08:00"), trade_id: t?.id ?? null, card });
    const r = run({
      trades: [t1!, t2!, t3!, t4!, t5!, t6!],
      analyses: [
        a(t1!, { direction: "buy", confidence: "عالية" }),
        a(t2!, { direction: "buy", confidence: "عالية" }),
        a(t3!, JSON.stringify({ direction: "sell", confidence: "ضعيفة" })),
        a(t4!, { direction: "sell", confidence: "متوسطة" }), // he went the other way
        a(null, { direction: "buy", confidence: "عالية" }),
        a(t6!, { direction: "buy", confidence: "ضعيفة" }, "2026-10-14"),
        a(t6!, { direction: "buy", confidence: "متوسطة" }, "2026-10-15"), // the latest card counts
      ],
    });
    expect(r.analystHitRate).toEqual({
      n: 4, hits: 3, rate: 0.75, small: true,
      byConfidence: {
        high: { n: 2, hits: 1, rate: 0.5 }, medium: { n: 1, hits: 1, rate: 1 },
        low: { n: 1, hits: 1, rate: 1 }, unknown: { n: 0, hits: 0, rate: null },
      },
    });
  });
});

describe("last period's rule", () => {
  const REVENGE_RULE = "بعد أي خسارة لا تدخل قبل ما تخلص التهدئة.";
  const weekly = (key: string, decision: string, over: Partial<PatternReview> = {}): PatternReview => ({
    trade_id: null, review_type: "weekly", period_key: key, verdict: "violation", decision, created_at: riy("2026-10-12", "08:00"),
    next_rules: [
      { text: REVENGE_RULE, trigger: "revenge_trade", duration: "next_week", reason: "" },
      { text: "كمّل على نفس قواعدك.", trigger: "none", duration: "next_week", reason: "" },
    ],
    ...over,
  });

  it("an accepted rule whose pattern came back is not kept, and is proposed again first", () => {
    const data = book([rt("2026-10-13", -40, "review", ["revenge_trade"]), rt("2026-10-14", 30, "ok")]);
    const r = run({ ...data, reviews: [...data.reviews, weekly("2026-W41", "accept_rules")] });
    expect(r.lastRuleAdherence).toMatchObject({
      period: "2026-W41", kept: false,
      rules: [
        { text: REVENGE_RULE, kept: false, evidence: "«صفقة تعويض» رجع مرة هالأسبوع." },
        { trigger: "none", kept: true },
      ],
    });
    expect(r.nextRules[0]).toMatchObject({ text: REVENGE_RULE, trigger: "revenge_trade", duration: "next_week" });
  });

  it("kept when the pattern stayed away; not judged without reviewed trades", () => {
    const data = book([rt("2026-10-14", 30, "ok")]);
    expect(run({ ...data, reviews: [...data.reviews, weekly("2026-W41", "modify_rules")] }).lastRuleAdherence?.kept).toBe(true);
    expect(run({ reviews: [weekly("2026-W41", "accept_rules")] }).lastRuleAdherence?.kept).toBeNull();
  });

  it("only a rule he chose counts, and only from the period right before", () => {
    const data = book([rt("2026-10-13", -40, "review", ["revenge_trade"])]);
    for (const extra of [weekly("2026-W41", "journal_only"), weekly("2026-W41", "defer"), weekly("2026-W40", "accept_rules"),
      weekly("2026-09", "accept_rules", { review_type: "monthly" })])
      expect(run({ ...data, reviews: [...data.reviews, extra] }).lastRuleAdherence).toBeNull();
  });
});

describe("an empty week, the stored row and the prompt", () => {
  it("an empty week is ok and keeps the rules", () => {
    const r = run({});
    expect(r).toMatchObject({ verdict: "ok", trades: 0, tagCounts: [], baselinePeriods: 0, lastRuleAdherence: null, inProgress: false });
    expect(r.nextRules).toEqual([{ text: "كمّل على نفس قواعدك وسجّل كل صفقة.", duration: "next_week", trigger: "none", reason: "ما في صفقات هالأسبوع." }]);
    expect(run({ now: new Date(riy("2026-10-14")) }).inProgress).toBe(true);
  });

  it("periodRow is the weekly / monthly trade_reviews row with the facts behind it", () => {
    const r = run(book([rt("2026-10-13", -40, "review", ["revenge_trade"])]));
    const row = periodRow(r);
    expect(row).toMatchObject({
      trade_id: null, review_type: "weekly", period_key: "2026-W42", verdict: "review",
      process_score: 100, tags: [{ tag: "revenge_trade", count: 1, trend: null }], next_rules: r.nextRules, findings: [], questions: [],
    });
    expect(JSON.parse(JSON.stringify(row.facts))).toEqual(r);
    expect(periodRow(run({ period: OCT })).review_type).toBe("monthly");
  });

  it("patternsForPrompt renders at most 4 weeks plus the last month, newest first", () => {
    const weeks = ["2026-W37", "2026-W42", "2026-W38", "2026-W41", "2026-W39", "2026-W40"].map((key) => run({ period: { kind: "week", key } }));
    const months = ["2026-09", "2026-10"].map((key) => run({ period: { kind: "month", key } }));
    const text = patternsForPrompt([...months, ...weeks]);
    expect(text.split("\n")[0]).toContain("لا تعيد حسابها");
    for (const key of ["2026-W42", "2026-W41", "2026-W40", "2026-W39", "2026-10"]) expect(text).toContain(`(${key})`);
    for (const key of ["2026-W38", "2026-W37", "2026-09"]) expect(text).not.toContain(`(${key})`);
    expect(text.indexOf("2026-W42")).toBeLessThan(text.indexOf("2026-W39"));
    expect(patternsForPrompt([])).toContain("ما في مراجعات أسابيع");
  });

  it("the prompt quotes the counts, trends and money as computed", () => {
    const rows: Row[] = [rt("2026-10-05", -10, "review", ["revenge_trade"])];
    for (const d of ["2026-10-12", "2026-10-13", "2026-10-14"]) rows.push(rt(d, -20, "review", ["revenge_trade"]));
    const check: PatternCheck = { id: "cx", created_at: riy("2026-10-15"), intent: "pre_entry", decision: "NO_GO", proceeded: false, actual_risk: 75 };
    const text = patternsForPrompt([run({ ...book(rows), checks: [check] })]);
    expect(text).toContain("صفقة تعويض 3 (زاد)");
    expect(text).toContain("-60$");
    expect(text).toContain("مخاطرة ما دخلتها 75$");
    expect(text).toContain("يتكرر كثير: صفقة تعويض");
  });
});
