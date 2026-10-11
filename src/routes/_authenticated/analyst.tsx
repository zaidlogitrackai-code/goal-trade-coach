import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/analyst")({
  head: () => ({ meta: [{ title: "المحلل الذكي — نظام هادي" }, { name: "description", content: "ارفع صورة الشارت ويحللها الذكاء الاصطناعي بناءً على استراتيجياتك." }] }),
  component: () => <ComingSoon title="المحلل الذكي" description="ارفع صورة الشارت ويحللها الذكاء الاصطناعي بناءً على استراتيجياتك." items={["تحليل صور الشارت", "مطابقة الإعداد مع استراتيجيتك", "تقييم جودة الصفقة قبل الدخول"]} />,
});
