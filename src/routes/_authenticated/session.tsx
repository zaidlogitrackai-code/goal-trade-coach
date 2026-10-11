import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, Loading, PageHeader, Stat } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { currentUserId, fmtDate, fmtMoney, settingsQuery, tradesQuery } from "@/lib/queries";
import { computeDayMetrics, startOfToday } from "@/lib/trading-status";
import { Timer, CheckCircle, AlertOctagon, PauseCircle, Play } from "lucide-react";

export const Route = createFileRoute("/_authenticated/session")({
  head: () => ({
    meta: [
      { title: "جلسة التداول — نظام هادي" },
      { name: "description", content: "خطة واضحة قبل التداول، مراقبة فورية أثناء الجلسة، ومراجعة مهيكلة بعد الإغلاق." },
    ],
  }),
  component: SessionPage,
});

const MOODS = ["هادئ", "واثق", "متوتر", "متعب", "متحمس"];

function SessionPage() {
  const qc = useQueryClient();
  const t = useQuery(tradesQuery);
  const s = useQuery(settingsQuery);

  // Pre-session Form state
  const [assets, setAssets] = useState("");
  const [timeframes, setTimeframes] = useState("");
  const [forbiddenRule, setForbiddenRule] = useState("");
  const [maxTrades, setMaxTrades] = useState("");
  const [plan, setPlan] = useState("");
  const [mood, setMood] = useState("هادئ");

  // Post-session Structured Review state
  const [followedPlan, setFollowedPlan] = useState<"yes" | "partial" | "no">("yes");
  const [hadGreed, setHadGreed] = useState<boolean>(false);
  const [hadRevenge, setHadRevenge] = useState<boolean>(false);
  const [bestDecision, setBestDecision] = useState("");
  const [worstDecision, setWorstDecision] = useState("");
  const [generalNotes, setGeneralNotes] = useState("");

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  const ss = useQuery({
    queryKey: ["sessions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trading_sessions")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
  });

  if (ss.isLoading || s.isLoading || t.isLoading) return <Loading />;

  const settings = s.data!;
  const cur = settings.currency ?? "USD";
  const active = ss.data?.find((x) => !x.ended_at);

  const startOfDay = startOfToday().getTime();
  const dayMetrics = computeDayMetrics(settings, t.data ?? [], 0);

  // Filter trades that belong to the active session
  const sessionTrades = active
    ? (t.data ?? []).filter(
        (x) => new Date(x.opened_at).getTime() >= new Date(active.started_at).getTime()
      )
    : [];

  const closedSessionTrades = sessionTrades.filter((x) => x.status === "closed");
  const sessionPnl = closedSessionTrades.reduce((acc, x) => acc + (Number(x.pnl) || 0), 0);
  const sessionRiskUsed = sessionTrades.reduce((acc, x) => acc + (Number(x.risk_amount) || 0), 0);

  async function startSession(e: React.FormEvent) {
    e.preventDefault();
    if (!plan.trim() && !assets.trim()) {
      toast.error("يرجى كتابة خطة الجلسة والأصول المراقبة");
      return;
    }

    const fullPlanText = [
      assets.trim() ? `الأصول: ${assets.trim()}` : "",
      timeframes.trim() ? `الفريمات: ${timeframes.trim()}` : "",
      maxTrades ? `أقصى صفقات: ${maxTrades}` : "",
      forbiddenRule.trim() ? `ممنوع اليوم: ${forbiddenRule.trim()}` : "",
      plan.trim() ? `الخطة: ${plan.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const user_id = await currentUserId();
    const { error } = await supabase
      .from("trading_sessions")
      .insert({ user_id, plan: fullPlanText, mood });

    if (error) {
      toast.error("تعذر بدء الجلسة");
      return;
    }

    setPlan("");
    setAssets("");
    setTimeframes("");
    setForbiddenRule("");
    setMaxTrades("");
    qc.invalidateQueries({ queryKey: ["sessions"] });
    toast.success("بدأت جلسة التداول بنجاح. تداول بانضباط وفق خطتك!");
  }

  async function endSession() {
    if (!active) return;

    const structuredReview = [
      `الالتزام بالخطة: ${followedPlan === "yes" ? "نعم بالكامل" : followedPlan === "partial" ? "جزئياً" : "لا"}`,
      `دخول بدافع الطمع: ${hadGreed ? "نعم" : "لا"}`,
      `دخول لتعويض خسارة: ${hadRevenge ? "نعم" : "لا"}`,
      bestDecision.trim() ? `أفضل قرار: ${bestDecision.trim()}` : "",
      worstDecision.trim() ? `قرار لن أكرره: ${worstDecision.trim()}` : "",
      generalNotes.trim() ? `ملاحظات: ${generalNotes.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const { error } = await supabase
      .from("trading_sessions")
      .update({ ended_at: new Date().toISOString(), review: structuredReview })
      .eq("id", active.id);

    if (error) {
      toast.error("تعذر إنهاء الجلسة");
      return;
    }

    // Reset review form
    setBestDecision("");
    setWorstDecision("");
    setGeneralNotes("");
    toast.success("تم إنهاء الجلسة وحفظ المراجعة السلوكية");
    qc.invalidateQueries({ queryKey: ["sessions"] });
  }

  async function deleteSession(id: string) {
    if (!confirm("حذف هذه الجلسة من السجل؟")) return;
    await supabase.from("trading_sessions").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["sessions"] });
    toast.success("تم حذف الجلسة");
  }

  async function togglePause() {
    const { error } = await supabase
      .from("trading_settings")
      .update({ trading_paused: !settings.trading_paused })
      .eq("user_id", settings.user_id);
    if (error) {
      toast.error("تعذر تحديث الحالة");
      return;
    }
    qc.invalidateQueries({ queryKey: ["settings"] });
    toast.success(settings.trading_paused ? "تم استئناف التداول" : "تم إيقاف التداول مؤقتاً");
  }

  const durationStr = (ms: number) => {
    const mins = Math.floor(ms / 60000);
    const hrs = Math.floor(mins / 60);
    return `${hrs}س ${mins % 60}د`;
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        title="جلسة التداول"
        subtitle="حلقة الانضباط: خطة واضحة قبل البدء، تركيز أثناء التنفيذ، ومراجعة بعد الإغلاق."
      />

      {active ? (
        /* DURING SESSION */
        <div className="panel space-y-6 p-6 border-2 border-primary/40 bg-muted/10">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-5">
            <div>
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full bg-primary animate-pulse" />
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">جلسة تداول نشطة</p>
              </div>
              <p className="font-data mt-1 text-3xl font-bold tracking-tight" dir="ltr">
                {new Date(now - +new Date(active.started_at)).toISOString().slice(11, 19)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                بدأت في {fmtDate(active.started_at)} · المزاج: {active.mood}
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-left font-data">
                <p className="text-xs text-muted-foreground">ربح / خسارة الجلسة</p>
                <p
                  dir="ltr"
                  className={`text-2xl font-bold ${
                    sessionPnl > 0 ? "text-success" : sessionPnl < 0 ? "text-destructive" : "text-foreground"
                  }`}
                >
                  {fmtMoney(sessionPnl, cur)}
                </p>
              </div>

              <Button
                variant={settings.trading_paused ? "default" : "destructive"}
                size="sm"
                onClick={togglePause}
                className="gap-1.5"
              >
                <PauseCircle className="size-4" />
                {settings.trading_paused ? "استئناف" : "إيقاف التداول"}
              </Button>
            </div>
          </div>

          {/* Real-time Session Metrics */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="صفقات الجلسة" value={sessionTrades.length} />
            <Stat label="مخاطرة الجلسة" value={fmtMoney(sessionRiskUsed, cur)} />
            <Stat
              label="المخاطرة المتبقية اليوم"
              value={dayMetrics.riskRemaining != null ? fmtMoney(dayMetrics.riskRemaining, cur) : "غير محدد"}
            />
            <Stat
              label="الخسائر المتتالية"
              value={dayMetrics.consecutiveLosses}
              tone={dayMetrics.consecutiveLosses > 0 ? "warning" : undefined}
            />
          </div>

          {/* Written Plan */}
          {active.plan && (
            <div className="rounded-lg bg-card border border-border p-4 space-y-1 text-xs">
              <span className="font-semibold text-primary block">خطة الجلسة وشروطك المقررة:</span>
              <p className="whitespace-pre-wrap leading-relaxed text-foreground/90">{active.plan}</p>
            </div>
          )}

          {/* Structured Post-Session Review Form */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <CheckCircle className="size-4 text-primary" />
              <span>مراجعة ما بعد الجلسة قبل الإغلاق</span>
            </h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">هل التزمت بالخطة الموضوعة؟</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={followedPlan === "yes" ? "default" : "secondary"}
                    onClick={() => setFollowedPlan("yes")}
                  >
                    نعم بالكامل
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={followedPlan === "partial" ? "default" : "secondary"}
                    onClick={() => setFollowedPlan("partial")}
                  >
                    جزئياً
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={followedPlan === "no" ? "destructive" : "secondary"}
                    onClick={() => setFollowedPlan("no")}
                  >
                    لا
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">هل دخلت أي صفقة بدافع الطمع أو الانتقام؟</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={hadGreed || hadRevenge ? "destructive" : "default"}
                    onClick={() => {
                      setHadGreed(false);
                      setHadRevenge(false);
                    }}
                  >
                    لا، قرارات منضبطة
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={hadGreed ? "destructive" : "secondary"}
                    onClick={() => setHadGreed(!hadGreed)}
                  >
                    طمع
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={hadRevenge ? "destructive" : "secondary"}
                    onClick={() => setHadRevenge(!hadRevenge)}
                  >
                    انتقام
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">ما هو أفضل قرار اتخذته اليوم؟</Label>
                <Input
                  placeholder="مثال: الالتزام بوقف الخسارة، الانتظار..."
                  value={bestDecision}
                  onChange={(e) => setBestDecision(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">ما هو القرار الذي لن تكرره؟</Label>
                <Input
                  placeholder="مثال: ملاحقة السعر، تحريك وقف الخسارة..."
                  value={worstDecision}
                  onChange={(e) => setWorstDecision(e.target.value)}
                />
              </div>

              <div className="sm:col-span-2 space-y-1.5">
                <Label className="text-xs">ملاحظات عامة لليوم</Label>
                <Textarea
                  placeholder="دروس اليوم التي تضيفها لمعرفتك..."
                  value={generalNotes}
                  onChange={(e) => setGeneralNotes(e.target.value)}
                />
              </div>
            </div>

            <Button onClick={endSession} size="lg" className="w-full sm:w-auto mt-2">
              إنهاء الجلسة وحفظ المراجعة
            </Button>
          </div>
        </div>
      ) : (
        /* PRE-SESSION PLANNING */
        <form onSubmit={startSession} className="panel space-y-5 p-6 border-border">
          <div className="border-b border-border pb-4">
            <h2 className="font-bold text-lg">التخطيط قبل بدء الجلسة</h2>
            <p className="text-xs text-muted-foreground mt-1">
              لا تتداول بالصدفة أو العاطفة. حدد نطاقك وشروطك مسبقاً قبل دخول السوق.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="assets">الأصول والأسواق المراقبة اليوم</Label>
              <Input
                id="assets"
                placeholder="مثال: XAUUSD, EURUSD"
                value={assets}
                onChange={(e) => setAssets(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="timeframes">الفريمات المعتمدة</Label>
              <Input
                id="timeframes"
                placeholder="مثال: 4H للاتجاه · 15M للدخول"
                value={timeframes}
                onChange={(e) => setTimeframes(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxTrades">أقصى عدد صفقات مستهدف لهذه الجلسة</Label>
              <Input
                id="maxTrades"
                type="number"
                min={1}
                placeholder={settings.max_trades_per_day ? String(settings.max_trades_per_day) : "3"}
                value={maxTrades}
                onChange={(e) => setMaxTrades(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="forbidden">شيء واحد ممنوع فعله اليوم (Forbidden Rule)</Label>
              <Input
                id="forbidden"
                placeholder="مثال: ممنوع الدخول قبل إغلاق الشمعة، ممنوع التداول بعد خسارة مباشرة"
                value={forbiddenRule}
                onChange={(e) => setForbiddenRule(e.target.value)}
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label>حالتك النفسية والذهنية الآن</Label>
              <div className="flex flex-wrap gap-2">
                {MOODS.map((m) => (
                  <Button
                    key={m}
                    type="button"
                    size="sm"
                    variant={mood === m ? "default" : "secondary"}
                    onClick={() => setMood(m)}
                  >
                    {m}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="plan">الخطة الفنية والإعدادات التي تنتظرها</Label>
              <Textarea
                id="plan"
                rows={3}
                placeholder="ما هي المستويات السعرية التي ستنتظر عندها ردة الفعل؟ ما هو شرط التأكيد؟"
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
              />
            </div>
          </div>

          <Button type="submit" size="lg" className="w-full sm:w-auto gap-2">
            <Play className="size-4" />
            بدء جلسة التداول
          </Button>
        </form>
      )}

      {/* PREVIOUS SESSIONS LIST */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold">سجل الجلسات السابقة</h2>
        {(ss.data ?? []).filter((x) => x.ended_at).length === 0 ? (
          <EmptyState text="جلساتك السابقة ومراجعاتها السلوكية تظهر هنا." />
        ) : (
          <div className="space-y-3">
            {ss.data!
              .filter((x) => x.ended_at)
              .map((sess) => {
                const tr = (t.data ?? []).filter(
                  (x) =>
                    x.status === "closed" &&
                    x.closed_at &&
                    x.closed_at >= sess.started_at &&
                    x.closed_at <= sess.ended_at!
                );
                const pnl = tr.reduce((acc, y) => acc + (Number(y.pnl) || 0), 0);
                const durationMs = +new Date(sess.ended_at!) - +new Date(sess.started_at);

                return (
                  <div key={sess.id} className="panel p-5 space-y-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2">
                      <div className="space-y-0.5">
                        <span className="font-semibold text-foreground">
                          {fmtDate(sess.started_at)}
                        </span>
                        <span className="text-xs text-muted-foreground block">
                          المدة: {durationStr(durationMs)} · المزاج: {sess.mood} · صفقات: {tr.length}
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        <span
                          dir="ltr"
                          className={`font-data text-base font-bold ${
                            pnl >= 0 ? "text-success" : "text-destructive"
                          }`}
                        >
                          {fmtMoney(pnl, cur)}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteSession(sess.id)}
                          className="text-xs text-destructive hover:bg-destructive/10"
                        >
                          حذف
                        </Button>
                      </div>
                    </div>

                    {sess.plan && (
                      <div className="text-xs text-muted-foreground bg-muted/20 p-2.5 rounded-lg space-y-0.5">
                        <span className="font-semibold text-primary block">الخطة المكتوبة:</span>
                        <p className="whitespace-pre-wrap">{sess.plan}</p>
                      </div>
                    )}

                    {sess.review && (
                      <div className="text-xs bg-muted/40 p-2.5 rounded-lg space-y-0.5">
                        <span className="font-semibold text-foreground block">المراجعة والتقييم:</span>
                        <p className="whitespace-pre-wrap">{sess.review}</p>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}

export default SessionPage;
