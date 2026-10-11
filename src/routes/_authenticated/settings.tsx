import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Loading, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { settingsQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "الإعدادات — نظام هادي" }, { name: "description", content: "إعدادات الحساب." }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { data, isLoading } = useQuery(settingsQuery);
  const qc = useQueryClient();
  const [name, setName] = useState<string | null>(null);
  const [tz, setTz] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  if (isLoading || !data) return <Loading />;
  if (!email) supabase.auth.getUser().then(({ data: u }) => setEmail(u.user?.email ?? ""));

  async function save() {
    const { error } = await supabase.from("trading_settings").update({
      display_name: name ?? data!.display_name,
      timezone: tz ?? data!.timezone,
    }).eq("user_id", data!.user_id);
    if (error) { toast.error("تعذر الحفظ"); return; }
    qc.invalidateQueries({ queryKey: ["settings"] });
    toast.success("تم الحفظ");
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="الإعدادات" />
      <div className="panel space-y-5 p-6">
        <div className="space-y-2"><Label>البريد الإلكتروني</Label><Input dir="ltr" value={email} disabled /></div>
        <div className="space-y-2"><Label>الاسم</Label><Input value={name ?? data.display_name ?? ""} onChange={(e) => setName(e.target.value)} placeholder="هادي" /></div>
        <div className="space-y-2"><Label>المنطقة الزمنية</Label><Input dir="ltr" value={tz ?? data.timezone} onChange={(e) => setTz(e.target.value)} /></div>
        <p className="text-sm text-muted-foreground">العملة وحدود التداول تعدّلها من <Link to="/risk" className="text-primary">إدارة المخاطر</Link>.</p>
        <Button onClick={save}>حفظ</Button>
      </div>
    </div>
  );
}
