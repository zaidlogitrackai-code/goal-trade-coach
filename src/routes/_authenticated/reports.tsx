import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "التقارير — نظام هادي" }, { name: "description", content: "تقارير أسبوعية وشهرية من بياناتك الفعلية." }] }),
  component: () => <ComingSoon title="التقارير" description="تقارير أسبوعية وشهرية من بياناتك الفعلية." items={["التقرير الأسبوعي", "التقرير الشهري", "تصدير التقارير"]} />,
});
