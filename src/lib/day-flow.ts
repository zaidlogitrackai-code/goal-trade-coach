import { dayPipeline, type DayPipeline, type PipelineState, type StepN } from "./day-pipeline";
import type { NavPath } from "./nav-registry";

/**
 * The dashboard's old five-step bar, now a thin adapter over day-pipeline.ts (one engine).
 * T14's StepCard replaces it and T34 deletes it.
 */
export type FlowStep = 1 | 2 | 3 | 4 | 5;
export const FLOW_LABELS = ["أهدافك", "ابدأ الجلسة", "الصفقات", "سكّر وراجع", "خلاص لليوم"] as const;

export interface FlowResult {
  step: FlowStep;
  message: string;
  action: string;
  to: NavPath;
  interview?: boolean;
  /** Step 2 opens the PlanSheet in place instead of navigating. */
  plan?: boolean;
  danger?: boolean;
}

/** Where each pipeline step sits on the old bar: the gate's stops read as «stop and close». */
const SLOT: Record<StepN, FlowStep> = { 0: 1, 1: 4, 2: 2, 3: 3, 4: 4, 5: 4, 6: 2 };

export function flowFromPipeline(p: DayPipeline): FlowResult {
  return {
    step: p.finished ? 5 : SLOT[p.current.n],
    message: p.current.message,
    action: p.cta.label,
    to: p.cta.to,
    ...(p.current.key === "setup" && p.cta.to === "/coach" ? { interview: true } : {}),
    ...(p.current.key === "plan" ? { plan: true } : {}),
    ...(p.current.tone === "danger" ? { danger: true } : {}),
  };
}

/** One next step for today, picked by the day pipeline. */
export function currentStep(s: PipelineState): FlowResult {
  return flowFromPipeline(dayPipeline(s));
}
