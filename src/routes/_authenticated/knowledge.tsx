import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/knowledge")({
  head: () => ({ meta: [{ title: "مركز المعرفة — نظام هادي" }, { name: "description", content: "مكتبتك الشخصية للتعلم والملاحظات." }] }),
  component: () => <ComingSoon title="مركز المعرفة" description="مكتبتك الشخصية للتعلم والملاحظات." items={["ملاحظات ودروس", "أخطاء متكررة", "مصادر يتعلم منها الذكاء الاصطناعي"]} />,
});
