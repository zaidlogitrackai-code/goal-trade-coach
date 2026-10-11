import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/discipline")({
  head: () => ({ meta: [{ title: "الانضباط والطمع — نظام هادي" }, { name: "description", content: "يكشف سلوكك قبل لا يكلفك." }] }),
  component: () => <ComingSoon title="الانضباط والطمع" description="يكشف سلوكك قبل لا يكلفك." items={["مؤشر الطمع", "فترات التهدئة بعد الخسائر", "درجة الانضباط اليومية"]} />,
});
