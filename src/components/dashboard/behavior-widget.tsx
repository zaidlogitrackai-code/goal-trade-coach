import { Link } from "@tanstack/react-router";
import { Sparkles, ArrowRight, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BehaviorWidgetProps {
  tradesCount: number;
  revengeCount: number;
  greedyCount: number;
  checklistRate: number;
  disciplineScore: number | null;
}

export function BehaviorWidget({
  tradesCount,
  revengeCount,
  greedyCount,
  checklistRate,
  disciplineScore,
}: BehaviorWidgetProps) {
  if (tradesCount < 3) {
    return (
      <div className="panel p-6 border-dashed border-border flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Brain className="size-6 text-muted-foreground/60 shrink-0" />
          <div>
            <h4 className="text-sm font-semibold">ملاحظات الانضباط السلوكي</h4>
            <p className="text-xs text-muted-foreground">
              سجّل 3 صفقات على الأقل حتى يقوم النظام بتحليل سلوكك واكتشاف قرارات الطمع والانتقام بدقة.
            </p>
          </div>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to="/discipline">تعرف على المؤشرات</Link>
        </Button>
      </div>
    );
  }

  // Derive single most important actionable insight
  let insightTitle = "ملاحظة الانضباط هذا الأسبوع";
  let insightText = "التزام ممتاز بالقواعد وقائمة التحقق. استمر على نفس هذا الانضباط لحماية رأس المال.";
  let tone: "success" | "warning" = "success";

  if (revengeCount > 0) {
    insightTitle = "احذر: مؤشر تداول انتقامي محتمل";
    insightText = `تم رصد فتح ${revengeCount} صفقات خلال أقل من 15 دقيقة بعد صفقة خاسرة. احرص على تفعيل فترة تهدئة 20 دقيقة بعد أي خسارة لاستعادة التركيز.`;
    tone = "warning";
  } else if (greedyCount > 0) {
    insightTitle = "تنبيه: صفقات بمشاعر طمع أو FOMO";
    insightText = `سجّلت ${greedyCount} صفقات بمشاعر طمع أو خوف من الفوات. تذكر: الفرص في السوق لا تنتهي، ورأس مالك لا يعوّض.`;
    tone = "warning";
  } else if (checklistRate < 80) {
    insightTitle = "تنبيه: عدم إكمال قائمة التحقق";
    insightText = `نسبة الالتزام بقائمة التحقق قبل الدخول هي ${Math.round(checklistRate)}%. الدخول قبل استيفاء الشروط يرفع نسبة الخطأ العشوائي.`;
    tone = "warning";
  } else if (disciplineScore != null && disciplineScore >= 80) {
    insightTitle = "إشادة: أداء منضبط للغاية";
    insightText = `درجة انضباطك الحالية ${disciplineScore}/100. التزامك بوقف الخسارة وخطة الجلسة يجعلك متداولاً محترفاً قادراً على الاستمرار.`;
    tone = "success";
  }

  return (
    <div className={`panel p-6 border-2 ${tone === "warning" ? "border-warning/30 bg-warning/5" : "border-success/30 bg-success/5"}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Sparkles className={`size-4 ${tone === "warning" ? "text-warning" : "text-success"}`} />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{insightTitle}</span>
          </div>
          <p className="text-sm leading-relaxed text-foreground max-w-2xl font-medium">
            {insightText}
          </p>
        </div>

        <Button asChild size="sm" variant={tone === "warning" ? "default" : "secondary"} className="shrink-0">
          <Link to="/discipline">
            <span>شاهد التحليل السلوكي</span>
            <ArrowRight className="size-3.5 mr-1" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
