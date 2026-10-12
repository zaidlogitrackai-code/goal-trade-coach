import { Link } from "@tanstack/react-router";
import { CheckCircle2, AlertTriangle, XCircle, PauseCircle, Clock, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export type BannerStatusCode =
  | "ready"
  | "caution"
  | "high_risk"
  | "rules_broken"
  | "target_hit"
  | "loss_limit"
  | "stopped"
  | "cooldown"
  | "no_session";

interface StatusBannerProps {
  status: BannerStatusCode;
  cooldownUntil?: string | null;
  hasActiveSession: boolean;
  consecutiveLosses: number;
  maxConsecutiveLosses: number;
}

export function StatusBanner({
  status,
  cooldownUntil,
  hasActiveSession,
  consecutiveLosses,
  maxConsecutiveLosses,
}: StatusBannerProps) {
  // Determine effective presentation
  let title = "جاهز للتداول";
  let description = "كل الحدود ضمن النطاق الآمن. التزم بخطتك المحددة.";
  let tone: "success" | "warning" | "destructive" | "primary" = "success";
  let Icon = CheckCircle2;
  let primaryAction = {
    label: hasActiveSession ? "تسجيل صفقة جديدة" : "ابدأ جلسة التداول أولاً",
    href: hasActiveSession ? "/new-trade" : "/session",
  };

  if (cooldownUntil && new Date(cooldownUntil).getTime() > Date.now()) {
    const timeStr = new Date(cooldownUntil).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });
    title = `فترة تهدئة حتى ${timeStr}`;
    description = "التداول موقوف مؤقتاً لاستعادة الهدوء وتجنب القرارات الانفعالية أو الانتقامية.";
    tone = "warning";
    Icon = Clock;
    primaryAction = { label: "راجع صفحة الانضباط", href: "/discipline" };
  } else if (status === "loss_limit") {
    title = "تم الوصول إلى حد الخسارة اليومية";
    description = "توقف إجباري لحماية رأس المال. السوق مستمر غداً، لا تفتح أي صفقات تعويضية.";
    tone = "destructive";
    Icon = ShieldAlert;
    primaryAction = { label: "راجع صفقات اليوم", href: "/trades" };
  } else if (status === "target_hit") {
    title = "الهدف اليومي تحقق بنجاح";
    description = "حققت هدفك المطلوب لليوم! احمِ أرباحك وتجنب الطمع وإعادة المكاسب للسوق.";
    tone = "success";
    Icon = CheckCircle2;
    primaryAction = { label: "أنهِ الجلسة واحمِ الربح", href: "/session" };
  } else if (status === "stopped") {
    title = "التداول متوقف";
    description = "أحد الحدود اليومية تم استهلاكه أو أن التداول موقوف يدوياً لحمايتك.";
    tone = "primary";
    Icon = PauseCircle;
    primaryAction = { label: "إدارة المخاطر والحدود", href: "/risk" };
  } else if (status === "rules_broken") {
    title = "مراجعة مطلوبة: تسجيل مخالفة";
    description = "تم تسجيل صفقة غير مطابقة أو خرق لقواعد التداول اليوم. راجع أسباب المخالفة.";
    tone = "destructive";
    Icon = XCircle;
    primaryAction = { label: "راجع الانضباط والمخالفات", href: "/discipline" };
  } else if (status === "high_risk") {
    title = "مستوى مخاطرة مرتفع";
    description = "اقتربت كثيراً من الحد الأقصى للمخاطرة أو الخسارة. فكّر بالتوقف لحماية الرصيد.";
    tone = "destructive";
    Icon = AlertTriangle;
    primaryAction = { label: "فحص الصفقات المفتوحة", href: "/trades" };
  } else if (status === "caution") {
    title = "تداول بحذر";
    description = "استهلكت جزءاً ملحوظاً من حدودك اليومية. خفّض حجم الصفقات وتأكد من جودة الإعداد.";
    tone = "warning";
    Icon = AlertTriangle;
    primaryAction = { label: "سجل صفقة جديدة بحذر", href: "/new-trade" };
  } else if (!hasActiveSession) {
    title = "جاهز — لا توجد جلسة نشطة";
    description = "ابدأ جلسة تداول واكتب خطتك والأصول المراقبة قبل الدخول في السوق.";
    tone = "primary";
    Icon = Clock;
    primaryAction = { label: "ابدأ جلسة التداول الآن", href: "/session" };
  }

  const borderStyles = {
    success: "border-success/40 bg-success/5 text-success",
    warning: "border-warning/40 bg-warning/5 text-warning",
    destructive: "border-destructive/40 bg-destructive/5 text-destructive",
    primary: "border-primary/40 bg-primary/5 text-foreground",
  }[tone];

  return (
    <div className={`panel relative overflow-hidden border p-4 transition-all sm:border-2 sm:p-8 ${borderStyles}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between md:gap-6">
        <div className="space-y-1.5 sm:space-y-2">
          <div className="flex items-center gap-2">
            <Icon className="size-5 shrink-0 sm:size-6" aria-hidden="true" />
            <span className="text-xs font-semibold opacity-80">قرار اليوم</span>
          </div>
          <h2 className="font-display text-xl font-bold text-foreground sm:text-3xl lg:text-4xl">
            {title}
          </h2>
          <p className="max-w-2xl text-xs leading-relaxed text-foreground/80 sm:text-base">
            {description}
          </p>
          {maxConsecutiveLosses > 0 && consecutiveLosses > 0 && (
            <p className="text-xs font-medium opacity-90">
              الخسائر المتتالية الحالية: {consecutiveLosses} من {maxConsecutiveLosses} مسموح
            </p>
          )}
        </div>

        <div className="shrink-0">
          <Button asChild className="w-full font-medium sm:h-10 sm:w-auto sm:px-8 sm:text-base">
            <Link to={primaryAction.href}>{primaryAction.label}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
