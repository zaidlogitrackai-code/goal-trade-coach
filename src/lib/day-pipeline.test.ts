import { describe, expect, it } from "vitest";
import {
  dayPipeline, isBlocked, pipelineForPrompt, pipelineState, STEPS,
  type PipelinePlan, type PipelineRows, type PipelineSession, type PipelineSettings, type PipelineTrade,
} from "./day-pipeline";
import { currentStep } from "./day-flow";
import { buildJourney, journeyForPrompt } from "./journey";
import type { Database } from "@/integrations/supabase/types";

// The pipeline takes the rows exactly as Supabase returns them (fails tsc if a column changes).
type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export const rowsFit = (s: Row<"trading_settings">, t: Row<"trades">, p: Row<"daily_plans">, x: Row<"trading_sessions">) =>
  [s, t, p, x] satisfies [PipelineSettings, PipelineTrade, PipelinePlan, PipelineSession];

const TZ = "Asia/Riyadh";
const NOW = "2026-10-14T15:00:00+03:00"; // Wednesday
const MONDAY = "2026-10-19T10:00:00+03:00";
const SINCE = "2026-10-01T00:00:00+03:00";
const at = (hhmm: string, day = "2026-10-14") => `${day}T${hhmm}:00+03:00`;

// A $200 daily stop on 10,000, two losses in a row → 24h, three trades a day.
const SETTINGS: PipelineSettings = {
  timezone: TZ, currency: "USD", current_balance: 10_000,
  max_daily_loss: 200, weekly_max_loss: 0, monthly_max_loss: 0, limits_pct: null,
  max_consecutive_losses: 2, streak_cooldown_hours: 24, trading_paused: false, cooldown_until: null,
  limits_accepted_at: SINCE, breaker_since: SINCE, paused_until: null, reviews_since: null,
  max_trades_per_day: 3, max_daily_profit: 0,
};
const PLAN: PipelinePlan = { no_trading: false, max_trades: null, target: null, max_loss: null, start_balance: 10_000 };
const SESSION: PipelineSession = { started_at: at("09:00"), ended_at: null };

let seq = 0;
function trade(over: Partial<PipelineTrade> & { pnl?: number | null }, closedAt: string | null = null): PipelineTrade {
  seq++;
  const opened = closedAt ? new Date(Date.parse(closedAt) - 20 * 60_000).toISOString() : at("10:00");
  return {
    id: `t${seq}`, symbol: "EURUSD", direction: "long", entry_price: 1 + seq / 100, exit_price: null,
    status: closedAt ? "closed" : "open", pnl: null, opened_at: opened, closed_at: closedAt, created_at: closedAt ?? opened,
    stop_loss: 1, ...over,
  };
}
const close = (pnl: number | null, when: string) => trade({ pnl }, when);

const READY: PipelineRows = {
  settings: SETTINGS, trades: [], plan: PLAN, sessions: [SESSION],
  focus: { markets: ["XAUUSD"], goal: "200$ بالأسبوع", weakness: "التعويض" },
  strategies: 1, rules: 2, weeklyReviewKeys: [],
};
const state = (over: Partial<PipelineRows> = {}, now = NOW) => pipelineState({ ...READY, now: new Date(now), ...over });
const run = (over: Partial<PipelineRows> = {}, now = NOW) => dayPipeline(state(over, now));
const codes = (p: ReturnType<typeof run>) => p.blockers.map((x) => x.code);

describe("the steps", () => {
  it("lists all seven steps with the step flow's titles", () => {
    const p = run();
    expect(p.steps.map((x) => x.n)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(p.steps.map((x) => x.title)).toEqual(["الإعداد", "بوابة اليوم", "خطة اليوم", "فحص الصفقة", "سكّر وراجع الصفقة", "سكّر يومك", "مراجعة الأسبوع"]);
    expect(p.steps.map((x) => x.title)).toEqual(STEPS.map((x) => x.title));
  });

  it("a clean day with a plan → 3, «صفقة جديدة», and closing the day once he traded", () => {
    const p = run();
    expect(p).toMatchObject({ current: { n: 3, key: "trade" }, cta: { label: "صفقة جديدة", to: "/new-trade" }, secondary: null, newTrade: true, finished: false, blockers: [] });
    expect(p.steps.find((x) => x.n === 3)!.status).toBe("current");
    expect(run({ trades: [close(40, at("11:00"))] }).secondary).toEqual({ label: "سكّر يومك", to: "/session" });
  });
});

describe("priority order", () => {
  it("fresh account → 0, asking for the focus profile first, then the strategy and the rules", () => {
    const fresh = run({ settings: { ...SETTINGS, max_daily_loss: 0, limits_accepted_at: null }, focus: null, strategies: 0, rules: 0, plan: null, sessions: [] });
    expect(fresh).toMatchObject({ current: { n: 0, key: "setup" }, cta: { to: "/coach" } });
    expect(codes(fresh)).toEqual(["setup", "setup", "setup", "no_plan"]);
    expect(fresh.steps[0]!.done).toBe(false);
    expect(run({ strategies: 0 }).cta.to).toBe("/strategies");
    expect(run({ rules: 0 }).cta.to).toBe("/rules");
  });

  it("a session left open from an earlier day → 1, close it first; one closed yesterday is fine", () => {
    const stale = run({ sessions: [{ started_at: at("09:00", "2026-10-13"), ended_at: null }] });
    expect(stale).toMatchObject({ current: { n: 1, key: "gate", tone: "warning" }, cta: { label: "سكّر الجلسة القديمة", to: "/session" } });
    expect(stale.current.message).toContain("2026-10-13");
    expect(run({ sessions: [{ started_at: at("09:00", "2026-10-13"), ended_at: at("18:00", "2026-10-13") }] }).current.n).toBe(3);
  });

  it("PARTIAL → 1 (repair), ahead of everything but setup and a stale session", () => {
    const p = run({ trades: [close(null, at("11:00")), trade({ stop_loss: null })] });
    expect(p).toMatchObject({ current: { n: 1, tone: "danger" }, cta: { label: "صلّح الصفقات", to: "/trades" }, newTrade: false });
    // PARTIAL is the breaker's stop: listed once, as the repair.
    expect(codes(p)).toEqual(["partial", "no_stop"]);
  });

  it("HALTED → 1 with the release time; plan and gate are off", () => {
    const p = run({ trades: [close(-200, at("12:00"))] });
    expect(p.current).toMatchObject({ n: 1, key: "gate", tone: "danger" });
    expect(p.current.message).toContain("يرجع التداول");
    expect(p.cta).toEqual({ label: "سكّر يومك", to: "/session" });
    expect(p.newTrade).toBe(false);
    // A plan already written stays done; with none, writing one is off too.
    expect(p.steps[2]!.status).toBe("done");
    expect(run({ plan: null, trades: [close(-200, at("12:00"))] }).steps[2]!.status).toBe("blocked");
    expect(p.steps[3]!.status).toBe("blocked");
    expect(isBlocked(state({ trades: [close(-200, at("12:00"))] }).breaker)).toBe(true);
    // Open trades: only managing them is left.
    expect(run({ trades: [close(-200, at("12:00")), trade({})] }).cta).toEqual({ label: "دير صفقاتك المفتوحة", to: "/trades" });
  });

  it("COOLDOWN → 1 with «راجع آخر خسارتين مع المحلل»", () => {
    const p = run({ trades: [close(-50, at("11:00")), close(-50, at("12:00"))] });
    expect(p.current).toMatchObject({ n: 1, tone: "warning" });
    expect(p.cta).toEqual({ label: "راجع آخر خسارتين مع المحلل", to: "/analyst" });
    expect(p.newTrade).toBe(false);
  });

  it("in preview the breaker's stop still leads, marked as a preview", () => {
    const p = run({ settings: { ...SETTINGS, breaker_since: null }, trades: [close(-200, at("12:00"))] });
    expect(p.current.n).toBe(1);
    expect(p.current.message).toContain("معاينة");
  });

  it("missing stop → 4 (danger), after the breaker", () => {
    const p = run({ trades: [trade({ stop_loss: null, symbol: "XAUUSD" })] });
    expect(p).toMatchObject({ current: { n: 4, key: "review", tone: "danger" }, cta: { label: "حط الوقف", to: "/trades" } });
    expect(p.current.message).toContain("XAUUSD");
    expect(run({ trades: [trade({ stop_loss: 0 })] }).current.n).toBe(4);
    expect(run({ trades: [close(-200, at("12:00")), trade({ stop_loss: null })] }).current.n).toBe(1);
  });

  it("an unreviewed close after reviews_since → 4; before the cutoff, reviewed, or with the rule off → not 4", () => {
    const cut = { ...SETTINGS, reviews_since: "2026-10-13T00:00:00+03:00" };
    const after = close(40, at("11:00"));
    const p = run({ settings: cut, trades: [after] });
    expect(p).toMatchObject({ current: { n: 4, key: "review", tone: "warning" }, cta: { label: "راجع الصفقة", to: "/trades" } });
    expect(state({ settings: cut, trades: [after] }).unreviewedClosed).toEqual([{ id: after.id, symbol: "EURUSD" }]);
    expect(run({ settings: cut, trades: [after], reviewedTradeIds: [after.id] }).current.n).toBe(3);
    expect(run({ settings: cut, trades: [close(40, at("11:00", "2026-10-12"))] }).current.n).toBe(3);
    expect(run({ trades: [after] }).current.n).toBe(3);
    // The stop comes first.
    expect(run({ settings: cut, trades: [after, trade({ stop_loss: null })] }).blockers.map((x) => x.code)).toEqual(["no_stop", "unreviewed"]);
  });

  it("no plan → 2", () => {
    const p = run({ plan: null });
    expect(p).toMatchObject({ current: { n: 2, key: "plan" }, cta: { label: "اكتب خطتك مع سَنَد", to: "/session" }, newTrade: true });
  });

  it("max trades → 5 as the main step, with «صفقة جديدة» hidden", () => {
    const three = [close(20, at("10:30")), close(20, at("11:30")), trade({})];
    const p = run({ trades: three });
    expect(p).toMatchObject({ current: { n: 5, key: "close", tone: "success" }, cta: { label: "سكّر يومك", to: "/session" }, newTrade: false });
    expect(p.current.message).toContain("وصلت حدّ صفقاتك اليوم");
    expect(p.steps[3]).toMatchObject({ done: true, status: "blocked" });
    expect(p.secondary).toEqual({ label: "شوف صفقاتك المفتوحة", to: "/trades" });
    // The plan's own count and target too.
    expect(run({ plan: { ...PLAN, max_trades: 1 }, trades: [close(20, at("10:30"))] }).current).toMatchObject({ n: 5 });
    expect(run({ plan: { ...PLAN, target: 100 }, trades: [close(120, at("10:30"))] }).current.message).toContain("وصلت هدف خطتك");
  });

  it("rest day → 5", () => {
    const p = run({ plan: { ...PLAN, no_trading: true } });
    expect(p).toMatchObject({ current: { n: 5, key: "close" }, newTrade: false });
    expect(codes(p)).toEqual(["rest_day"]);
  });

  it("Monday with last week unreviewed → 6, ahead of a halt; reviewed, untracked or an empty week → not", () => {
    const mon = (over: Partial<PipelineRows>) => run({ sessions: [], plan: null, trades: [close(-30, at("11:00", "2026-10-14"))], ...over }, MONDAY);
    expect(mon({})).toMatchObject({ current: { n: 6, key: "week" }, cta: { label: "راجع أسبوعك", to: "/reports" } });
    expect(state({ trades: [close(-30, at("11:00"))] }, MONDAY).weekly).toEqual({ key: "2026-W42", due: true });
    expect(mon({ settings: { ...SETTINGS, trading_paused: true } }).current.n).toBe(6);
    expect(mon({ weeklyReviewKeys: ["2026-W42"] }).current.n).toBe(2);
    expect(mon({ weeklyReviewKeys: null }).current.n).toBe(2);
    // Nothing closed last week: nothing to review.
    expect(mon({ trades: [] }).current.n).toBe(2);
  });

  it("a closed day is finished: no plan step, no new trade; a missing stop still holds it", () => {
    const closed = [{ started_at: at("09:00"), ended_at: at("14:00") }];
    const p = run({ sessions: closed, plan: null });
    expect(p).toMatchObject({ finished: true, current: { n: 5 }, cta: { to: "/performance" }, newTrade: false, blockers: [] });
    expect(p.steps.every((x) => x.status !== "current")).toBe(true);
    const held = run({ sessions: closed, trades: [trade({ stop_loss: null })] });
    expect(held).toMatchObject({ finished: false, current: { n: 4 } });
  });
});

describe("pipelineForPrompt", () => {
  it("names the step, its button, what comes after and what is done", () => {
    const text = pipelineForPrompt(run({ plan: null, trades: [trade({ stop_loss: null })] }));
    expect(text).toContain("4 من 6 «سكّر وراجع الصفقة»");
    expect(text).toContain("«حط الوقف»");
    expect(text).toContain("2 «خطة اليوم»");
    expect(text).toContain("المنجز: الإعداد");
    expect(pipelineForPrompt(run({ trades: [close(-200, at("12:00"))] }))).toContain("صفقة جديدة مو مطروحة اليوم");
    expect(pipelineForPrompt(run({ sessions: [{ started_at: at("09:00"), ended_at: at("14:00") }] }))).toContain("أنهى يومه");
  });
});

describe("adapters", () => {
  const cases: [string, Partial<PipelineRows>, string?][] = [
    ["fresh", { focus: null, strategies: 0, rules: 0, plan: null, sessions: [] }],
    ["stale session", { sessions: [{ started_at: at("09:00", "2026-10-13"), ended_at: null }] }],
    ["halted", { trades: [close(-200, at("12:00"))] }],
    ["cooldown", { trades: [close(-50, at("11:00")), close(-50, at("12:00"))] }],
    ["no stop", { trades: [trade({ stop_loss: null })] }],
    ["unreviewed", { settings: { ...SETTINGS, reviews_since: SINCE }, trades: [close(40, at("11:00"))] }],
    ["no plan", { plan: null }],
    ["max trades", { trades: [close(20, at("10:30")), close(20, at("11:30")), close(20, at("12:30"))] }],
    ["rest day", { plan: { ...PLAN, no_trading: true } }],
    ["monday", { trades: [close(-30, at("11:00"))], sessions: [], plan: null }, MONDAY],
    ["closed", { sessions: [{ started_at: at("09:00"), ended_at: at("14:00") }] }],
    ["ready", {}],
  ];

  it.each(cases)("%s: the journey, the dashboard flow and pipelineForPrompt name the same step", (_, over, now) => {
    const s = state(over, now ?? NOW);
    const p = dayPipeline(s);
    const prompt = pipelineForPrompt(p);
    const j = buildJourney(s);
    const flow = currentStep(s);
    expect(journeyForPrompt(j)).toBe(prompt);
    expect(flow.message).toBe(p.current.message);
    expect(flow.action).toBe(p.cta.label);
    expect(flow.to).toBe(p.cta.to);
    if (p.finished) {
      expect(j.current).toBeNull();
      expect(flow.step).toBe(5);
    } else {
      expect(j.current).toMatchObject({ n: p.current.n, title: p.current.title, to: p.cta.to, cta: p.cta.label });
      expect(prompt).toContain(`${j.current!.n} من 6 «${j.current!.title}» — ${flow.message}`);
    }
  });
});
