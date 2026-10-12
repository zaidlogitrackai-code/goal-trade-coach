import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Moon, Sun, Download, Trash2, Shield, Bell, GraduationCap, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Loading, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { settingsQuery } from "@/lib/queries";
import { TRAINING_OFF_CATEGORY, KNOWLEDGE_OFF_CATEGORY } from "@/lib/hidden-notes";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "الإعدادات — نظام هادي" },
      { name: "description", content: "إعدادات الحساب، المظهر، الخصوصية، وتصدير البيانات." },
    ],
  }),
  component: SettingsPage,
});

function ThemeToggle() {
  const [light, setLight] = useState(false);
  useEffect(() => {
    setLight(document.documentElement.classList.contains("light"));
  }, []);

  function set(next: boolean) {
    setLight(next);
    document.documentElement.classList.toggle("light", next);
    try {
      localStorage.setItem("hadi-theme", next ? "light" : "dark");
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-2">
      <Label>المظهر العام</Label>
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant={light ? "outline" : "default"}
          onClick={() => set(false)}
        >
          <Moon className="size-4" /> داكن (موصى به)
        </Button>
        <Button
          type="button"
          variant={light ? "default" : "outline"}
          onClick={() => set(true)}
        >
          <Sun className="size-4" /> فاتح
        </Button>
      </div>
    </div>
  );
}

function AiSwitch({ to, category, queryKey, icon: Icon, heading, label, hint, onMsg, offMsg }: {
  to: "/training" | "/knowledge"; category: string; queryKey: string; icon: typeof GraduationCap; heading: string; label: string; hint: string; onMsg: string; offMsg: string;
}) {
  const qc = useQueryClient();
  const { data: enabled, isLoading } = useQuery({
    queryKey: [queryKey],
    queryFn: async () => {
      const { data } = await supabase.from("knowledge_notes").select("id").eq("category", category).limit(1);
      return !(data && data.length > 0);
    },
  });

  async function change(next: boolean) {
    qc.setQueryData([queryKey], next);
    if (next) {
      const { error } = await supabase.from("knowledge_notes").delete().eq("category", category);
      if (error) toast.error("تعذر التفعيل");
    } else {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("knowledge_notes").insert({
        user_id: u.user!.id,
        title: heading + " موقوف",
        content: "off",
        category,
      });
      if (error) toast.error("تعذر الإيقاف");
    }
    qc.invalidateQueries({ queryKey: [queryKey] });
    toast.success(next ? onMsg : offMsg);
  }

  return (
    <label className="flex items-center justify-between gap-4 cursor-pointer text-xs">
      <div className="min-w-0 space-y-0.5">
        <span className="font-semibold text-sm text-foreground flex items-center gap-2">
          <Icon className="size-4 text-primary" /> {label}
        </span>
        <span className="text-muted-foreground">{hint}</span>
        <Link to={to} className="inline-block pt-1 text-primary underline-offset-4 hover:underline">فتح الصفحة</Link>
      </div>
      <Switch checked={enabled ?? true} disabled={isLoading} onCheckedChange={change} />
    </label>
  );
}

function AiFeatureToggles() {
  return (
    <div className="panel space-y-5 p-6">
      <h3 className="font-semibold text-base">ما يستخدمه الذكاء الاصطناعي</h3>
      <AiSwitch
        to="/training"
        category={TRAINING_OFF_CATEGORY}
        queryKey="training-enabled"
        icon={GraduationCap}
        heading="تدريب الذكاء"
        label="تدريب الذكاء (استراتيجية هادي)"
        hint="لما يكون شغّال، المحلل وسَنَد يحكمون على كل صفقة حسب أمثلتك (صح/غلط) وقواعدك."
        onMsg="تدريب الذكاء مفعّل"
        offMsg="تدريب الذكاء موقوف"
      />
      <AiSwitch
        to="/knowledge"
        category={KNOWLEDGE_OFF_CATEGORY}
        queryKey="knowledge-enabled"
        icon={BookOpen}
        heading="مركز المعرفة"
        label="مركز المعرفة"
        hint="لما يكون شغّال، الوكلاء يرجعون لملاحظاتك في مركز المعرفة. ملاحظاتك تبقى محفوظة لو أوقفته."
        onMsg="مركز المعرفة مفعّل"
        offMsg="مركز المعرفة موقوف"
      />
    </div>
  );
}

function SettingsPage() {
  const { data, isLoading } = useQuery(settingsQuery);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [name, setName] = useState<string | null>(null);
  const [tz, setTz] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [saveCharts, setSaveCharts] = useState(true);
  const [allowAiImprovement, setAllowAiImprovement] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [busyExport, setBusyExport] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: u }) => setEmail(u.user?.email ?? ""));
  }, []);

  if (isLoading || !data) return <Loading />;

  async function save() {
    const { error } = await supabase
      .from("trading_settings")
      .update({
        display_name: name ?? data!.display_name,
        timezone: tz ?? data!.timezone,
      })
      .eq("user_id", data!.user_id);

    if (error) {
      toast.error("تعذر حفظ الإعدادات");
      return;
    }
    qc.invalidateQueries({ queryKey: ["settings"] });
    toast.success("تم حفظ الإعدادات بنجاح");
  }

  async function exportData() {
    setBusyExport(true);
    try {
      const [trades, sessions, rules, violations, strats] = await Promise.all([
        supabase.from("trades").select("*"),
        supabase.from("trading_sessions").select("*"),
        supabase.from("trading_rules").select("*"),
        supabase.from("rule_violations").select("*"),
        supabase.from("strategies").select("*"),
      ]);

      const bundle = {
        exportedAt: new Date().toISOString(),
        settings: data,
        trades: trades.data ?? [],
        sessions: sessions.data ?? [],
        rules: rules.data ?? [],
        violations: violations.data ?? [],
        strategies: strats.data ?? [],
      };

      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `logitrack-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("تم تصدير نسخة من بياناتك بنجاح");
    } catch {
      toast.error("تعذر تصدير البيانات");
    } finally {
      setBusyExport(false);
    }
  }

  async function clearTradesData() {
    const prompt = window.prompt("لحذف سجل الصفقات والجلسات، اكتب كلمة: حذف");
    if (prompt !== "حذف") return;

    try {
      await Promise.all([
        supabase.from("trades").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
        supabase.from("trading_sessions").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
        supabase.from("rule_violations").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
      ]);
      await qc.invalidateQueries();
      toast.success("تم مسح سجل الصفقات والجلسات بنجاح");
    } catch {
      toast.error("تعذر حذف البيانات");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="الإعدادات والخصوصية" />

      {/* Account & Profile */}
      <div className="panel space-y-5 p-6">
        <h3 className="font-semibold text-base">الحساب والمظهر</h3>
        <ThemeToggle />

        <div className="space-y-2">
          <Label>البريد الإلكتروني</Label>
          <Input dir="ltr" value={email} disabled className="opacity-70 bg-muted" />
        </div>

        <div className="space-y-2">
          <Label>الاسم المعروض</Label>
          <Input
            value={name ?? data.display_name ?? ""}
            onChange={(e) => setName(e.target.value)}
            placeholder="هادي العجمي"
          />
        </div>

        <div className="space-y-2">
          <Label>المنطقة الزمنية</Label>
          <Input
            dir="ltr"
            value={tz ?? data.timezone}
            onChange={(e) => setTz(e.target.value)}
            placeholder="Asia/Riyadh"
          />
        </div>

        <Button onClick={save}>حفظ التغييرات</Button>
      </div>

      <AiFeatureToggles />

      {/* Privacy & AI Governance (Phase 10) */}
      <div className="panel space-y-5 p-6">
        <div className="flex items-center gap-2">
          <Shield className="size-5 text-primary" />
          <h3 className="font-semibold text-base">الخصوصية وحوكمة الذكاء الاصطناعي</h3>
        </div>

        <div className="space-y-4 text-xs">
          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <div className="min-w-0 space-y-0.5">
              <span className="font-semibold text-sm text-foreground block">حفظ تحليلات الشارتات المرفوعة</span>
              <span className="text-muted-foreground">الاحتفاظ بسجل تحليلات الصور التي ترفعها للمحلل الذكي.</span>
            </div>
            <Switch checked={saveCharts} onCheckedChange={setSaveCharts} />
          </label>

          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <div className="min-w-0 space-y-0.5">
              <span className="font-semibold text-sm text-foreground block">السماح باستخدام البيانات مجهولة المصدر للتحسين</span>
              <span className="text-muted-foreground">استخدام أنماط السلوك المجردة لتحسين دقة كشف الطمع والانتقام.</span>
            </div>
            <Switch checked={allowAiImprovement} onCheckedChange={setAllowAiImprovement} />
          </label>

          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <div className="min-w-0 space-y-0.5">
              <span className="font-semibold text-sm text-foreground block">إشعارات الانضباط والرسالة الصباحية</span>
              <span className="text-muted-foreground">تلقي إشعارات عند اقتراب حدود المخاطر ورسالة صباحية بالخطة.</span>
            </div>
            <Switch checked={notificationsEnabled} onCheckedChange={setNotificationsEnabled} />
          </label>
        </div>
      </div>

      {/* Data Management & Export (Phase 10) */}
      <div className="panel space-y-4 p-6 border-border">
        <h3 className="font-semibold text-base">إدارة وتصدير البيانات</h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          بياناتك ملكك بالكامل. يمكنك تنزيل نسخة احتياطية من كل صفقاتك وجلساتك وقواعدك في أي وقت بصيغة JSON.
        </p>

        <div className="flex flex-wrap gap-3 pt-2">
          <Button
            variant="secondary"
            onClick={exportData}
            disabled={busyExport}
            className="gap-2 text-xs"
          >
            <Download className="size-4" />
            {busyExport ? "جارٍ التصدير…" : "تصدير بياناتي (JSON)"}
          </Button>

          <Button
            variant="destructive"
            onClick={clearTradesData}
            className="gap-2 text-xs"
          >
            <Trash2 className="size-4" />
            مسح سجل الصفقات
          </Button>
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;
