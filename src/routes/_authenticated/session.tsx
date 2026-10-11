import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/session")({
  head: () => ({ meta: [{ title: "جلسة التداول — نظام هادي" }, { name: "description", content: "إدارة جلستك اليومية من البداية للنهاية." }] }),
  component: () => <ComingSoon title="جلسة التداول" description="إدارة جلستك اليومية من البداية للنهاية." items={["بدء وإنهاء الجلسة", "خطة اليوم قبل التداول", "مراجعة نهاية الجلسة"]} />,
});
