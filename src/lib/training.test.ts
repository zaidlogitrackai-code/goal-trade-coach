import { describe, expect, it } from "vitest";
import { trainingScore } from "./training";
const full = { entry_conditions: "a", exit_conditions: "b", markets: "c", timeframes: "d" };
describe("trainingScore", () => {
  it("is 0 with nothing", () => expect(trainingScore({ strategies: [], examples: [] })).toBe(0));
  it("strategy only gives 40", () => expect(trainingScore({ strategies: [full], examples: [] })).toBe(40));
  it("full strategy + 10 mixed examples is 100", () =>
    expect(trainingScore({ strategies: [full], examples: [...Array(5)].map(() => ({ verdict: "good" })).concat([...Array(5)].map(() => ({ verdict: "bad" }))) })).toBe(100));
  it("only good examples misses balance", () =>
    expect(trainingScore({ strategies: [full], examples: [...Array(10)].map(() => ({ verdict: "good" })) })).toBe(90));
});
