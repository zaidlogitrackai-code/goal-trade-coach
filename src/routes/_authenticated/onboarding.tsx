import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Logo } from "@/components/app-shell";
import { AiSetup } from "@/components/ai-setup";
import { Button } from "@/components/ui/button";
import { settingsQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({ meta: [{ title: "إعداد النظام — نظام هادي للتداول" }, { name: "description", content: "إعداد حدود التداول اليومية." }] }),
  component: Onboarding,
});

function Onboarding() {
  useQuery(settingsQuery);
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Logo />
      <h1 className="mt-10 text-3xl font-bold">ابدأ بإعداد نظام التداول الخاص بك</h1>
      <p className="mt-2 text-muted-foreground">هذه الحدود هي اللي يحميك بها النظام كل يوم. تقدر تعدلها لاحقاً من إدارة المخاطر.</p>
      <div className="mt-8 space-y-3">
        <AiSetup onFinished={() => navigate({ to: "/dashboard" })} />
        <Button variant="secondary" className="w-full" onClick={() => navigate({ to: "/dashboard" })}>خلصت، ودّني للرئيسية</Button>
      </div>
    </div>
  );
}
