import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Logo } from "@/components/app-shell";
import { AiSetup } from "@/components/ai-setup";
import { Button } from "@/components/ui/button";
import { rulesQuery, settingsQuery, strategiesQuery } from "@/lib/queries";
import { useCapital } from "@/lib/capital-store";
import { setupMissing } from "@/lib/setup";
import { finishSetup } from "@/lib/setup-store";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({ meta: [{ title: "إعداد النظام — نظام هادي للتداول" }, { name: "description", content: "إعداد حدود التداول اليومية." }] }),
  component: Onboarding,
});

function Onboarding() {
  const qc = useQueryClient();
  const s = useQuery(settingsQuery);
  const st = useQuery(strategiesQuery);
  const r = useQuery(rulesQuery);
  const capital = useCapital();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const missing = setupMissing({ settings: s.data ?? null, strategies: st.data ?? [], rules: r.data ?? [], balance: capital?.summary.balance });

  async function finish() {
    setBusy(true);
    try {
      await finishSetup();
      await qc.invalidateQueries({ queryKey: settingsQuery.queryKey });
      void navigate({ to: "/dashboard" });
    } catch (e) { toast.error(e instanceof Error ? e.message : "ما قدرت أكمل الإعداد"); }
    finally { setBusy(false); }
  }

  async function onAiFinished() {
    await Promise.all([s.refetch(), st.refetch(), r.refetch()]);
    // The cards just ran; read the fresh state before deciding the setup is complete.
    const after = setupMissing({ settings: qc.getQueryData(settingsQuery.queryKey) ?? null, strategies: qc.getQueryData(strategiesQuery.queryKey) ?? [], rules: qc.getQueryData(rulesQuery.queryKey) ?? [], balance: capital?.summary.balance });
    if (!after.length) await finish();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pt-[calc(2.5rem+env(safe-area-inset-top))] pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
      <Logo />
      <h1 className="mt-10 text-3xl font-bold">ابدأ بإعداد نظام التداول الخاص بك</h1>
      <p className="mt-2 text-muted-foreground">هذه الحدود هي اللي يحميك بها النظام كل يوم. تقدر تعدلها لاحقاً من إدارة المخاطر.</p>
      <div className="mt-8 space-y-3">
        <AiSetup onFinished={() => void onAiFinished()} />
        {missing.length > 0 && s.data && (
          <p className="text-sm text-muted-foreground">باقي: {missing.join("، ")}. تقدر تكمّل لاحقاً، بس النظام بيذكّرك كل يوم.</p>
        )}
        <Button variant="secondary" className="h-11 w-full" disabled={busy} onClick={() => void finish()}>
          {missing.length ? "كمّل لاحقاً" : "خلصت، ودّني للرئيسية"}
        </Button>
      </div>
    </div>
  );
}
