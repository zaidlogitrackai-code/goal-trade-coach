import { Link } from "@tanstack/react-router";
import { Check, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Journey, Step } from "@/lib/journey";

/** "خطواتك": the client's path, one step highlighted with a single button. */
export function JourneySteps({ journey }: { journey: Journey }) {
  const { steps, current, setupDone } = journey;
  const shown = setupDone ? steps.filter((s) => s.phase === "today") : steps;

  return (
    <section className="panel space-y-4 p-5" aria-labelledby="journey-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="journey-title" className="text-lg font-semibold">
          {setupDone ? "خطوات اليوم" : "خطواتك للبداية"}
        </h2>
        {setupDone && (
          <span className="flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-0.5 text-xs text-success">
            <Check className="size-3.5" aria-hidden="true" /> الإعداد مكتمل
          </span>
        )}
      </div>

      <ol className="grid gap-2 sm:grid-cols-3">
        {shown.map((s) => (
          <StepItem key={s.key} step={s} current={current?.key === s.key} />
        ))}
      </ol>

      {current ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <div>
            <p className="text-xs text-primary">
              الخطوة {current.n} من {steps.length}
            </p>
            <p className="mt-0.5 font-semibold">{current.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{current.hint}</p>
          </div>
          <Button asChild>
            <Link to={current.to}>
              {current.cta}
              <ArrowLeft className="mr-1.5 size-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      ) : (
        <p className="rounded-lg bg-success/10 p-4 text-sm text-success">
          خلّصت خطوات اليوم. ارجع بكرا وابدأ جلسة جديدة.
        </p>
      )}
    </section>
  );
}

function StepItem({ step, current }: { step: Step; current: boolean }) {
  return (
    <li
      aria-current={current ? "step" : undefined}
      className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm ${
        current
          ? "border-primary bg-primary/5 font-medium text-foreground"
          : step.done
            ? "border-border text-muted-foreground"
            : "border-dashed border-border text-muted-foreground/70"
      }`}
    >
      <span
        className={`flex size-6 shrink-0 items-center justify-center rounded-full font-data text-xs ${
          step.done
            ? "bg-success text-success-foreground"
            : current
              ? "bg-primary text-primary-foreground"
              : "bg-muted"
        }`}
      >
        {step.done ? <Check className="size-3.5" aria-label="منجز" /> : step.n}
      </span>
      <span className={step.done ? "line-through decoration-muted-foreground/40" : ""}>
        {step.title}
      </span>
    </li>
  );
}
