import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/queries";

/** Risk guardian panel: latest alerts, reminders the agents set, and a one-click fix for conflicting limits. */
export function RiskGuardian({ settings }: { settings: { user_id: string; daily_target: number; max_daily_profit: number } | null }) {
  const qc = useQueryClient();
  const alerts = useQuery({
    queryKey: ["notifications", "risk"],
    queryFn: async () => {
      const { data, error } = await supabase.from("notifications").select("id,title,body,created_at").in("kind", ["risk", "reminder", "evening"]).order("created_at", { ascending: false }).limit(8);
      if (error) throw error;
      return data;
    },
  });
  const reminders = useQuery({
    queryKey: ["reminders"],
    queryFn: async () => {
      const { data, error } = await supabase.from("reminders").select("*").eq("active", true).order("next_at");
      if (error) throw error;
      return data;
    },
  });
  const conflict = settings && settings.max_daily_profit > 0 && settings.daily_target > settings.max_daily_profit;

  async function fix() {
    if (!settings) return;
    const { error } = await supabase.from("trading_settings").update({ max_daily_profit: settings.daily_target }).eq("user_id", settings.user_id);
    if (error) { toast.error("تعذر التصحيح"); return; }
    toast.success(`صار الحد الأعلى للربح ${settings.daily_target} مثل هدفك اليومي`);
    qc.invalidateQueries({ queryKey: ["settings"] });
  }
  async function remove(id: string) {
    await supabase.from("reminders").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["reminders"] });
  }

  return (
    <section className="panel mb-6 space-y-4 p-5" aria-label="حارس المخاطر">
      <div className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-5 text-success" aria-hidden="true" /> حارس المخاطر</div>
      <p className="text-xs text-muted-foreground">يراقب حدودك كل دقيقة وأنت فاتح الموقع، وينبهك بالجرس. اطلب من المدرب: "ذكّرني كل يوم الساعة 9 بخطتي".</p>
      {conflict && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 p-3 text-sm">
          <span>هدفك اليومي ({settings!.daily_target}) أكبر من الحد الأعلى للربح ({settings!.max_daily_profit}).</span>
          <Button size="sm" onClick={fix}>صحّح لي التعارض</Button>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-sm font-medium">آخر التنبيهات</h3>
          {(alerts.data ?? []).length === 0 ? <p className="text-xs text-muted-foreground">لا توجد بيانات بعد</p> : alerts.data!.map((a) => (
            <div key={a.id} className="rounded-lg bg-muted/40 p-2.5 text-sm">
              <p className="font-medium">{a.title}</p>
              <p className="text-xs text-muted-foreground">{fmtDate(a.created_at)}</p>
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-medium">تذكيراتك</h3>
          {(reminders.data ?? []).length === 0 ? <p className="text-xs text-muted-foreground">لا توجد بيانات بعد</p> : reminders.data!.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 p-2.5 text-sm">
              <div>
                <p className="font-medium">{r.title}</p>
                <p className="text-xs text-muted-foreground">{r.repeat === "daily" ? `كل يوم ${r.at_time?.slice(0, 5)}` : fmtDate(r.next_at)}</p>
              </div>
              <button aria-label="حذف التذكير" onClick={() => remove(r.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
