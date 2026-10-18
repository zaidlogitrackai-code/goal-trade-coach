import { Link, useNavigate } from "@tanstack/react-router";
import { Check, Bot, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FLOW_LABELS, type FlowResult } from "@/lib/day-flow";
import { COACH_DRAFT_KEY } from "@/components/dashboard/quick-coach";
import { safeSession } from "@/lib/safe-storage";

export function DayFlow({ flow }: { flow: FlowResult }) {
  const nav = useNavigate();
  function interview() {
    safeSession.set(COACH_DRAFT_KEY, JSON.stringify({ text: "أنا أبدأ الحين. اسألني عن أهدافي وحدودي والطمع وحطها بالنظام", image: null }));
    void nav({ to: "/coach" });
  }
  return (
    <div className="space-y-3">
      <ol className="flex items-center gap-1.5" aria-label="خطوات اليوم">
        {FLOW_LABELS.map((label, i) => {
          const n = i + 1;
          const done = n < flow.step;
          const now = n === flow.step;
          return (
            <li key={label} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <span className={`h-1 w-full rounded-full ${done || now ? "bg-foreground/80" : "bg-muted"}`} />
              <span className={`flex items-center gap-1 truncate text-[11px] lg:text-xs ${now ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                {done && <Check className="size-3 shrink-0" />}
                <span className="truncate">{label}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <div className={`panel flex flex-col gap-4 p-4 sm:p-6 md:flex-row md:items-center md:justify-between ${flow.danger ? "border-destructive/40 bg-destructive/5" : ""}`}>
        <div className="flex min-w-0 items-start gap-3">
          <div className={`grid size-10 shrink-0 place-items-center rounded-full ${flow.danger ? "bg-destructive/15 text-destructive" : "bg-muted/50"}`}>
            {flow.danger ? <AlertTriangle className="size-5" /> : <Bot className="size-5" />}
          </div>
          <div className="min-w-0 space-y-1">
            <span className="text-xs text-muted-foreground">الخطوة {flow.step} من 5 · المدرب</span>
            <p className="font-display text-lg font-semibold leading-7 lg:text-xl">{flow.message}</p>
          </div>
        </div>
        {flow.interview ? (
          <Button className="w-full shrink-0 md:w-auto md:px-6" onClick={interview}>{flow.action}</Button>
        ) : (
          <Button asChild className="w-full shrink-0 md:w-auto md:px-6"><Link to={flow.to}>{flow.action}</Link></Button>
        )}
      </div>
    </div>
  );
}
