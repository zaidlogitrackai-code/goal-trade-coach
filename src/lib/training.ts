/** How complete Hadi's strategy training is (0–100). Pure, shared by the training page. */
export interface TrainingInput {
  strategies: { entry_conditions: string | null; exit_conditions: string | null; markets: string | null; timeframes: string | null }[];
  examples: { verdict: string }[];
}
export const EXAMPLE_GOAL = 10;

export function trainingScore({ strategies, examples }: TrainingInput): number {
  const s = strategies[0];
  const fields = s ? [s.entry_conditions, s.exit_conditions, s.markets, s.timeframes].filter((v) => !!v?.trim()).length : 0;
  const good = examples.filter((e) => e.verdict === "good").length;
  const bad = examples.filter((e) => e.verdict === "bad").length;
  const ex = Math.min(examples.length, EXAMPLE_GOAL) / EXAMPLE_GOAL;
  const balance = good && bad ? 1 : 0;
  return Math.round(fields * 10 + ex * 50 + balance * 10);
}
