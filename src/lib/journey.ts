import { dayPipeline, pipelineForPrompt, STEPS, type DayPipeline, type PipelineState, type StepKey } from "./day-pipeline";
import type { NavPath } from "./nav-registry";

/**
 * The client's steps for the nav dot and the old «خطواتك» list: a thin adapter over
 * day-pipeline.ts, so they always point where the Today card points. T34 deletes it.
 */
export type Step = {
  key: StepKey;
  n: number;
  title: string;
  hint: string;
  cta: string;
  to: NavPath;
  done: boolean;
  phase: "setup" | "today";
};

/** current is null once the day is closed and nothing holds it. */
export type Journey = { steps: Step[]; current: Step | null; setupDone: boolean; pipeline: DayPipeline };

export function journeyFromPipeline(p: DayPipeline): Journey {
  const steps: Step[] = p.steps.map((x) => {
    // The current step carries today's own button; the others their usual one.
    const cta = x.n === p.current.n ? p.cta : STEPS[x.n]!.cta;
    return { key: x.key, n: x.n, title: x.title, hint: x.hint, cta: cta.label, to: cta.to, done: x.done, phase: x.n === 0 ? "setup" : "today" };
  });
  return { steps, current: p.finished ? null : steps[p.current.n]!, setupDone: p.steps[0]!.done, pipeline: p };
}

export function buildJourney(s: PipelineState): Journey {
  return journeyFromPipeline(dayPipeline(s));
}

/** One line for the coach prompt: the pipeline's own. */
export function journeyForPrompt(j: Journey): string {
  return pipelineForPrompt(j.pipeline);
}
