import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LimitsForm } from "@/components/limits-form";
import { Loading, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { settingsQuery } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/risk")({
  head: () => ({ meta: [{ title: "إدارة المخاطر — نظام هادي للتداول" }, { name: "description", content: "حدود الربح والخسارة والمخاطرة اليومية." }] }),
  component: RiskPage,
});

function RiskPage() {
  const { data, isLoading } = useQuery(settingsQuery);
  const qc = useQueryClient();
  if (isLoading) return <Loading />;
  async function togglePause() {
    if (!data) return;
    const { error } = await supabase.from("trading_settings").update({ trading_paused: !data.trading_paused }).eq("user_id", data.user_id);
    if (error) return toast.error("تعذر التحديث");
    qc.invalidateQueries({ queryKey: ["settings"] });
    toast.success(data.trading_paused ? "تم استئناف التداول" : "تم إيقاف التداول");
  }
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="إدارة المخاطر"
        subtitle="حدودك اليومية التي يحاسبك عليها النظام."
        action={<Button variant={data?.trading_paused ? "default" : "destructive"} onClick={togglePause}>{data?.trading_paused ? "استئناف التداول" : "إيقاف التداول الآن"}</Button>}
      />
      <LimitsForm key={data?.updated_at} initial={data ?? null} submitLabel="حفظ التغييرات" />
    </div>
  );
}
