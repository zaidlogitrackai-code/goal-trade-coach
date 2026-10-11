import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/performance")({
  head: () => ({ meta: [{ title: "الأداء — نظام هادي" }, { name: "description", content: "تحليل أدائك الحقيقي من صفقاتك." }] }),
  component: () => <ComingSoon title="الأداء" description="تحليل أدائك الحقيقي من صفقاتك." items={["نسبة الربح والخسارة", "الأداء حسب الاستراتيجية", "الأداء حسب الحالة النفسية"]} />,
});
