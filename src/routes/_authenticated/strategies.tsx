import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ChatHeader, EmptyState, Loading, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { currentUserId, strategiesQuery } from "@/lib/queries";
import { Layers, Sparkles, Plus, AlertOctagon } from "lucide-react";
import { useAgentChats } from "@/components/agent-chats";
import { SessionAgent } from "@/components/session-agent";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/confirm-dialog";

export const Route = createFileRoute("/_authenticated/strategies")({
  head: () => ({
    meta: [
      { title: "استراتيجياتي — نظام هادي" },
      { name: "description", content: "مدرّب ذكي يتعلّم استراتيجيتك، يحللها معك ويختبرك عليها." },
      { property: "og:title", content: "مدرّب الاستراتيجية — نظام هادي" },
      { property: "og:description", content: "مدرّب ذكي يتعلّم استراتيجيتك، يحللها معك ويختبرك عليها." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StrategiesPage,
});

export const STRATEGY_THREAD = "مدرّب الاستراتيجية";
const GREETING = "هلا هادي، أنا **مدرّب الاستراتيجية**.\n\nاشرح لي استراتيجيتك كأني ما أعرف شي: وش تتداول، على أي فريم، ومتى تدخل بالضبط؟ تقدر تكتب أو تتكلم أو ترفع صورة شارت.";
const QUICK = ["أشرح لك استراتيجيتي", "حلّل استراتيجياتي", "اختبرني", "عدّل استراتيجية"];

function StrategiesPage() {
  const qc = useQueryClient();
  const { data } = useQuery(strategiesQuery);
  const n = data?.length ?? 0;
  const { c, controls } = useAgentChats(STRATEGY_THREAD, GREETING);
  return (
    <div className="agent-page mx-auto w-full max-w-4xl">
      <ChatHeader
        status={n ? `عندك ${n} استراتيجية` : "ما عندك استراتيجية بعد — اشرح لي وحدة"}
        actions={<>
          {controls}
          <Sheet>
            <SheetTrigger asChild>
              <Button size="icon" variant="secondary" className="size-9 rounded-full" aria-label="استراتيجياتي"><Layers className="size-4" /></Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[92%] overflow-y-auto sm:max-w-xl">
              <SheetHeader><SheetTitle>استراتيجياتي</SheetTitle></SheetHeader>
              <div className="mt-4"><StrategyManager /></div>
            </SheetContent>
          </Sheet>
        </>}
      />
      {c && <SessionAgent
        key={c}
        threadId={c}
        hasActive={false}
        title={STRATEGY_THREAD}
        greeting={GREETING}
        quick={QUICK}
        mode="strategy"
        placeholder="اشرح لمدرّب الاستراتيجية…"
        onChanged={() => qc.invalidateQueries({ queryKey: ["strategies"] })}
      />}
    </div>
  );
}

const EMPTY = {
  name: "",
  description: "",
  entry_conditions: "",
  exit_conditions: "",
  markets: "",
  timeframes: "",
};

const TEMPLATE_STRATEGY = {
  name: "اختراق وإعادة اختبار (Breakout & Retest)",
  description: "استراتيجية ترند تعتمد على اختراق مستوى دعم أو مقاومة قوي ثم انتظار إعادة الاختبار للتأكيد مع وقف خسارة ضيق.",
  markets: "الذهب (XAUUSD), العملات الرئيسية (EURUSD, GBPUSD)",
  timeframes: "4H للاتجاه العام · 15M للدخول",
  entry_conditions: "1. إغلاق شمعة صريحة أعلى المقاومة أو أدنى الدعم على فريم 15M.\n2. إعادة اختبار المستوى بحجم تداول منخفض.\n3. ظهور شمعة انعكاسية (Pin bar أو Engulfing) باتجاه الاختراق.",
  exit_conditions: "الهدف: 1:2 كحد أدنى أو أقرب منطقة سيولة مقابلة.\nالوقف: أسفل قاع إعادة الاختبار بـ 5-10 نقاط.\nحالات منع التداول: قبل الأخبار عالية التأثير بـ 15 دقيقة، أو في الأسواق العرضية الضيقة.",
};

function StrategyManager() {
  const { data, isLoading } = useQuery(strategiesQuery);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(EMPTY);
  if (isLoading) return <Loading />;
  const refresh = () => qc.invalidateQueries({ queryKey: ["strategies"] });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) {
      toast.error("يرجى إدخال اسم الاستراتيجية");
      return;
    }
    const { error } = await supabase.from("strategies").insert({
      ...f,
      user_id: await currentUserId(),
    });
    if (error) {
      toast.error("تعذر حفظ الاستراتيجية");
      return;
    }
    setF(EMPTY);
    setOpen(false);
    refresh();
    toast.success("تمت إضافة الاستراتيجية بنجاح");
  }

  async function addTemplate() {
    const user_id = await currentUserId();
    const { error } = await supabase.from("strategies").insert({
      ...TEMPLATE_STRATEGY,
      user_id,
    });
    if (error) {
      toast.error("تعذر إضافة الاستراتيجية النموذجية");
      return;
    }
    refresh();
    toast.success("تمت إضافة استراتيجية نموذجية بنجاح! يمكنك تعديلها في أي وقت.");
  }

  async function toggle(id: string, allowed: boolean) {
    const { error } = await supabase.from("strategies").update({ allowed }).eq("id", id);
    if (error) {
      toast.error("تعذر التحديث");
      return;
    }
    refresh();
    toast.success(allowed ? "تم تفعيل الاستراتيجية" : "تم إيقاف الاستراتيجية مؤقتاً");
  }

  async function remove(id: string) {
    const { error } = await supabase.from("strategies").delete().eq("id", id);
    if (error) {
      toast.error("تعذر الحذف");
      return;
    }
    refresh();
    toast.success("تم حذف الاستراتيجية");
  }

  const field = (k: keyof typeof EMPTY, label: string, area = false, placeholder = "") => (
    <div className="space-y-2">
      <Label>{label}</Label>
      {area ? (
        <Textarea
          placeholder={placeholder}
          value={f[k]}
          onChange={(e) => setF({ ...f, [k]: e.target.value })}
        />
      ) : (
        <Input
          placeholder={placeholder}
          value={f[k]}
          onChange={(e) => setF({ ...f, [k]: e.target.value })}
        />
      )}
    </div>
  );

  const list = data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="استراتيجياتي"
        subtitle="المسموحة فقط تظهر في الصفقة الجديدة."
        action={
          <div className="flex gap-2">
            <Button onClick={() => setOpen(!open)}>
              {open ? "إلغاء" : "استراتيجية جديدة"}
            </Button>
          </div>
        }
      />

      {open && (
        <form onSubmit={add} className="panel grid gap-4 p-6 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <h3 className="font-semibold text-base mb-1">توثيق استراتيجية جديدة</h3>
            <p className="text-xs text-muted-foreground">التوثيق الدقيق يمنع الدخول العشوائي ويساعد المحلل الذكي في فحص شروطك بدقة.</p>
          </div>
          {field("name", "اسم الاستراتيجية", false, "مثال: اقتناص السيولة في الافتتاح")}
          {field("markets", "الأسواق والأصول المراقبة", false, "مثال: EURUSD، GBPUSD، الذهب (ذهب، فضة، مؤشرات، نفط)")}
          {field("timeframes", "الفريمات الزمنية", false, "مثال: 1H / 5M")}
          {field("description", "وصف مختصر للمفهوم الفني", false, "الفكرة الأساسية وراء الاستراتيجية")}
          <div className="sm:col-span-2">
            {field("entry_conditions", "شروط الدخول والتأكيد (Entry Conditions)", true, "1. كسر هيكل السوق\n2. تشكل فجوة سعرية FVG\n3. إغلاق شمعة انعكاسية")}
          </div>
          <div className="sm:col-span-2">
            {field("exit_conditions", "قواعد وقف الخسارة والخروج وحالات منع التداول (No-Trade)", true, "وقف الخسارة: أعلى الشمعة بـ 5 نقاط\nالهدف: 1:2 كحد أدنى\nشروط عدم الدخول: في أوقات الأخبار أو السيولة الضعيفة")}
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button type="submit">حفظ الاستراتيجية</Button>
          </div>
        </form>
      )}

      {list.length === 0 ? (
        !open && (
          <div className="panel p-8 text-center space-y-4 max-w-xl mx-auto">
            <Layers className="size-10 mx-auto text-muted-foreground/60" />
            <h3 className="text-lg font-bold">لا توجد استراتيجيات موثقة بعد</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              التداول بدون استراتيجية موثقة هو المقامرة بعينها. ابدأ بتوثيق استراتيجيتك الأولى، أو أضف الاستراتيجية النموذجية المعدّة مسبقاً لتعديلها.
            </p>
            <div className="flex flex-wrap justify-center gap-3 pt-2">
              <Button onClick={() => setOpen(true)} className="gap-2">
                <Plus className="size-4" />
                كتابة استراتيجيتي الخاصة
              </Button>
              <Button onClick={addTemplate} variant="secondary" className="gap-2">
                <Sparkles className="size-4 text-primary" />
                استخدام نموذج مبدئي جاهز
              </Button>
            </div>
          </div>
        )
      ) : (
        <div className="grid gap-4">
          {list.map((x) => (
            <div key={x.id} className="panel space-y-4 p-6 border-border/80">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <h3 className="text-lg font-bold text-foreground">{x.name}</h3>
                  {(x.markets || x.timeframes) && (
                    <p className="text-xs text-muted-foreground" dir="auto">
                      {[x.markets, x.timeframes].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <span className={x.allowed ? "text-success" : "text-muted-foreground"}>
                    {x.allowed ? "مسموحة" : "موقوفة"}
                  </span>
                  <Switch checked={x.allowed} onCheckedChange={(v) => toggle(x.id, v)} />
                </label>
              </div>

              {x.description && (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {x.description}
                </p>
              )}

              {x.entry_conditions && (
                <div className="rounded-lg bg-muted/40 p-3 space-y-1 text-xs">
                  <p className="font-semibold text-primary">شروط الدخول (Entry Checklist):</p>
                  <p className="whitespace-pre-wrap leading-relaxed text-foreground/90">{x.entry_conditions}</p>
                </div>
              )}

              {x.exit_conditions && (
                <div className="rounded-lg bg-muted/20 border border-border/40 p-3 space-y-1 text-xs">
                  <p className="font-semibold text-muted-foreground flex items-center gap-1">
                    <AlertOctagon className="size-3 text-warning" />
                    <span>قواعد الخروج وحالات عدم الدخول (No-Trade):</span>
                  </p>
                  <p className="whitespace-pre-wrap leading-relaxed text-foreground/80">{x.exit_conditions}</p>
                </div>
              )}

              <div className="flex justify-end pt-2 border-t border-border/40">
                <ConfirmDialog
                  trigger={<Button size="sm" variant="ghost" className="text-destructive">حذف الاستراتيجية</Button>}
                  title="تحذف هذي الاستراتيجية؟"
                  description={`«${x.name}» بتنحذف من استراتيجياتك. لو بدك توقفها بس، طفّي «مسموحة».`}
                  confirmLabel="احذف الاستراتيجية"
                  destructive
                  onConfirm={() => void remove(x.id)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

