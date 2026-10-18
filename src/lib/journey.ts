import type { NavPath } from "./nav-registry";

/**
 * The client's steps, in order: set up once (focus, strategy, rules), then the
 * same three steps every day (open session -> trade through the checklist ->
 * close and review). The first step not done is the one thing to do now.
 */
export type JourneyState = {
  focusReady: boolean;
  strategies: number;
  rules: number;
  /** Today's latest session, if one was started today. */
  sessionToday: { active: boolean; ended: boolean } | null;
  tradesToday: number;
  /** A limit or cooldown stopped trading for today. */
  blocked: boolean;
};

export type StepKey = "focus" | "strategy" | "rules" | "session" | "trade" | "close";
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

export type Journey = { steps: Step[]; current: Step | null; setupDone: boolean };

export function buildJourney(s: JourneyState): Journey {
  const session = s.sessionToday;
  const raw: Omit<Step, "n">[] = [
    {
      key: "focus",
      phase: "setup",
      title: "اكتب ملف تركيزك",
      hint: "زوجك من الفوركس، هدفك، ونقطة ضعفك. احكيهم للمدرب وهو بيحفظهم.",
      cta: "احكي للمدرب",
      to: "/coach",
      done: s.focusReady,
    },
    {
      key: "strategy",
      phase: "setup",
      title: "أضف استراتيجيتك",
      hint: "شروط الدخول والخروج والأزواج اللي بتتداولها.",
      cta: "أضف استراتيجية",
      to: "/strategies",
      done: s.strategies > 0,
    },
    {
      key: "rules",
      phase: "setup",
      title: "اكتب قواعدك",
      hint: "القواعد اللي ما بتكسرها مهما صار.",
      cta: "اكتب قواعدك",
      to: "/rules",
      done: s.rules > 0,
    },
    {
      key: "session",
      phase: "today",
      title: "ابدأ جلسة اليوم",
      hint: "خطتك ومزاجك قبل ما تفتح الشارت.",
      cta: "ابدأ الجلسة",
      to: "/session",
      done: !!session,
    },
    s.blocked
      ? {
          key: "trade",
          phase: "today",
          title: "التداول متوقف اليوم",
          hint: "وصلت حدك. ما في صفقات جديدة لبكرا.",
          cta: "شوف السبب",
          to: "/dashboard",
          done: true,
        }
      : {
          key: "trade",
          phase: "today",
          title: "سجّل صفقتك عبر البوابة",
          hint: "البوابة بتفحص حدودك وقائمة التحقق قبل الدخول.",
          cta: "صفقة جديدة",
          to: "/new-trade",
          done: s.tradesToday > 0,
        },
    {
      key: "close",
      phase: "today",
      title: "أغلق الجلسة وراجعها",
      hint: "لما تخلص: شو التزمت فيه وشو كسرته.",
      cta: "راجع الجلسة",
      to: "/session",
      done: !!session?.ended,
    },
  ];
  const steps = raw.map((x, i) => ({ ...x, n: i + 1 }));
  // When the day is blocked with no session, there is nothing left to do today.
  const pending = steps.filter((x) => !x.done && !(s.blocked && !session && x.phase === "today"));
  return { steps, current: pending[0] ?? null, setupDone: steps.slice(0, 3).every((x) => x.done) };
}

/** One line for the coach prompt. */
export function journeyForPrompt(j: Journey): string {
  const done = j.steps.filter((x) => x.done).map((x) => x.title);
  return j.current
    ? `خطوة العميل الحالية (${j.current.n} من ${j.steps.length}): ${j.current.title}. المنجز: ${done.join("، ") || "لا شيء"}.`
    : "العميل أنهى كل خطوات اليوم.";
}
