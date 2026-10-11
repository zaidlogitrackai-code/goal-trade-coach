import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/coach")({
  head: () => ({ meta: [{ title: "المدرب الذكي — نظام هادي" }, { name: "description", content: "مدرب شخصي يتكلم معك بالعربي ويعرف صفقاتك وقواعدك." }] }),
  component: () => <ComingSoon title="المدرب الذكي" description="مدرب شخصي يتكلم معك بالعربي ويعرف صفقاتك وقواعدك." items={["محادثات متعددة محفوظة", "مراجعة يومية ذكية", "تدريب الذكاء على استراتيجيتك"]} />,
});
