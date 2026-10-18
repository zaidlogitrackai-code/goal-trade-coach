import { describe, expect, it } from "vitest";
import { CONTEXT_CAPS, formatContext, TODAY_HEAD, type ContextData, type CtxTrade } from "./ai-context-format";
import { breakerForPrompt } from "./circuit-breaker";
import { dayPipeline, pipelineForPrompt, pipelineState, type PipelineSettings } from "./day-pipeline";
import { lastLoss } from "./pre-trade-gate";

const TZ = "Asia/Riyadh";
const NOW = new Date("2026-10-14T15:00:00+03:00");
const SINCE = "2026-10-01T00:00:00+03:00";
const at = (hhmm: string, day = "2026-10-14") => `${day}T${hhmm}:00+03:00`;

const SETTINGS: PipelineSettings = {
  timezone: TZ, currency: "USD", current_balance: 10_000,
  max_daily_loss: 200, weekly_max_loss: 0, monthly_max_loss: 0, limits_pct: null,
  max_consecutive_losses: 0, streak_cooldown_hours: 24, trading_paused: false, cooldown_until: null,
  limits_accepted_at: SINCE, breaker_since: SINCE, paused_until: null, reviews_since: null,
  max_trades_per_day: 3, max_daily_profit: 0,
};

let seq = 0;
function trade(pnl: number, closedAt: string, over: Partial<CtxTrade> = {}): CtxTrade {
  seq++;
  return {
    id: `t${seq}`, symbol: "XAUUSD", direction: "long", status: "closed",
    entry_price: 2400 + seq, stop_loss: 2390, take_profit: 2420, exit_price: 2395, pnl, risk_amount: 100,
    emotion: "متوتر", notes: `دخلت بعد الخبر ${seq}`, close_notes: "طلعت بالوقف", opened_at: new Date(Date.parse(closedAt) - 20 * 60_000).toISOString(), closed_at: closedAt,
    strategy_id: "s1", ...over,
  };
}

// A HALTED day: two losses today, 250$ past a 200$ daily stop.
function haltedDay(extraTrades = 0): ContextData {
  seq = 0;
  const trades = [trade(-150, at("11:00")), trade(-100, at("14:30")), ...Array.from({ length: extraTrades }, (_, i) => trade(10, at("10:00", `2026-10-0${(i % 9) + 1}`)))];
  const state = pipelineState({
    settings: SETTINGS, trades, plan: { no_trading: false, max_trades: 3, target: 100, max_loss: 200, start_balance: 10_000 },
    sessions: [{ started_at: at("09:00"), ended_at: null }],
    focus: { markets: ["XAUUSD"], goal: "200$ بالأسبوع", weakness: "التعويض" },
    strategies: 1, rules: 1, weeklyReviewKeys: null, now: NOW,
  });
  return {
    now: NOW, tz: TZ, currency: "USD", todayKey: "2026-10-14",
    breaker: state.breaker, pipeline: dayPipeline(state),
    today: { trades: state.tradesToday, pnl: state.pnlToday, open: state.openTrades, planReached: state.planReached, protect: null, plan: { day: "2026-10-14", target: 100, max_trades: 3, risk_per_trade: 100, max_loss: 200, note: null, no_trading: false }, planFlags: [] },
    checks: Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, created_at: at(`1${i % 5}:0${i % 9}`), symbol: "XAUUSD", direction: "long", intent: "pre_entry", decision: i === 0 ? "NO_GO" : "GO", proceeded: i === 0, reasons: i === 0 ? [{ code: "breaker", decision: "NO_GO", text: "القاطع موقف التداول" }] : [], override_reason: i === 0 ? "حسّيت بفرصة" : null })),
    lastLoss: lastLoss(trades, [], NOW),
    reviews: [{ trade_id: "t1", created_at: at("12:00"), verdict: "violation", tags: [{ tag: "revenge_trade" }], root_cause: "rule_violation" }],
    periods: [],
    violations: [{ rule_id: "r1", source: "gate", occurred_at: at("14:30") }, { rule_id: "r1", source: "manual", occurred_at: at("14:40") }],
    sessions: [{ id: "sess1", started_at: at("09:00"), ended_at: null, plan: "ذهب بس، صفقتين", review: null, mood: "هادي" }],
    trades: [...trades].reverse(),
    strategies: [{ id: "s1", name: "اختراق لندن", description: null, entry_conditions: "كسر القمة", exit_conditions: null, markets: "XAUUSD, US100", timeframes: "M15", allowed: true }],
    rules: [{ id: "r1", title: "لا تعويض بعد خسارة", description: null, active: true }],
    examples: [],
    notes: [{ title: "درس", category: null, content: "x".repeat(1000) }],
    profile: ["ملف ثابت"],
  };
}

describe("formatContext on a HALTED day", () => {
  const d = haltedDay();
  const out = formatContext(d, "agent");

  it("puts the breaker line first, quoted from its engine", () => {
    expect(d.breaker?.state).toBe("HALTED");
    expect(out.startsWith(breakerForPrompt(d.breaker!, "USD"))).toBe(true);
    expect(out.split("\n")[0]).toContain("موقوف");
  });

  it("quotes the same step as dayPipeline, right after the breaker", () => {
    expect(d.pipeline.current.n).toBe(1);
    const i = out.indexOf(pipelineForPrompt(d.pipeline));
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(out.indexOf(TODAY_HEAD));
  });

  it("keeps the blocks in order", () => {
    const order = [TODAY_HEAD, "قرارات البوابة اليوم", "آخر خسارة قبل", "مراجعات صفقات", "أنماطك بالأسابيع", "المخالفات آخر 30 يوم", "جلسات", "آخر الصفقات", "معرّفات اليوم", "الاستراتيجيات:"];
    const idx = order.map((x) => out.indexOf(x));
    expect(idx.every((x) => x >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it("gives today's numbers, the last loss and the gate's override", () => {
    expect(out).toContain("صفقات اليوم: 2، ربح/خسارة محققة اليوم: -250$");
    expect(out).toContain("آخر خسارة قبل 30 دقيقة (-100$ على XAUUSD)");
    expect(out).toContain("لا تدخل ×1");
    expect(out).toContain("سببه: حسّيت بفرصة");
    expect(out).toContain("لا تعويض بعد خسارة ×2");
    expect(out).toContain("صفقة تعويض ×1");
  });

  it("includes his notes and the strategy's markets", () => {
    expect(out).toContain("ملاحظاته: دخلت بعد الخبر 2");
    expect(out).toContain("عند الإغلاق: طلعت بالوقف");
    expect(out).toContain("أسواق XAUUSD, US100، فريمات M15");
    expect(out).toContain("XAUUSD=t1");
    expect(out).toContain("الجلسة المفتوحة sess1");
  });

  it("respects the caps of each mode", () => {
    const many = haltedDay(50);
    const agent = formatContext(many, "agent"), brief = formatContext(many, "brief");
    const tradeLines = (s: string) => s.split("\n").filter((l) => /^- t\d+ \|/.test(l)).length;
    expect(tradeLines(agent)).toBe(CONTEXT_CAPS.agent.trades);
    expect(tradeLines(brief)).toBe(CONTEXT_CAPS.brief.trades);
    expect(agent).toContain(`آخر ${CONTEXT_CAPS.agent.checks} فحوصات`);
    expect(brief).toContain(`آخر ${CONTEXT_CAPS.brief.checks} فحوصات`);
    // Knowledge notes: truncated content for agents, titles only for one-shot notes.
    expect(agent).toContain(`درس: ${"x".repeat(CONTEXT_CAPS.agent.noteChars)}…`);
    expect(brief).not.toContain("درس: x");
  });

  it("says when training and knowledge are switched off", () => {
    const off = formatContext({ ...d, examples: null, notes: null }, "agent");
    expect(off).toContain("أوقف استخدام التدريب");
    expect(off).toContain("أوقف استخدام مركز المعرفة");
  });
});
