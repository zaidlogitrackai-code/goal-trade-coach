import { Link } from "@tanstack/react-router";
import { Timer, ArrowRight, Play, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtMoney, fmtDate } from "@/lib/queries";

interface ActiveSessionData {
  id: string;
  started_at: string;
  plan: string | null;
  mood: string | null;
}

interface SessionWidgetProps {
  activeSession: ActiveSessionData | null;
  sessionTradesCount: number;
  sessionPnl: number;
  currency: string;
}

export function SessionWidget({
  activeSession,
  sessionTradesCount,
  sessionPnl,
  currency,
}: SessionWidgetProps) {
  if (!activeSession) {
    return (
      <div className="panel flex flex-col justify-between gap-4 p-6 sm:flex-row sm:items-center">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground text-xs font-semibold">
            <Timer className="size-4" />
            <span>جلسة التداول اليومية</span>
          </div>
          <h3 className="font-semibold text-base sm:text-lg">لم تبدأ جلسة اليوم</h3>
          <p className="text-xs text-muted-foreground sm:text-sm">
            اكتب خطتك وحدد الأصول المسموحة وحالتك النفسية قبل أن تفتح الشارتات.
          </p>
        </div>
        <Button asChild className="shrink-0 font-medium">
          <Link to="/session">
            <Play className="size-4 ml-1.5" />
            ابدأ جلسة التداول
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="panel space-y-4 p-6 border-primary/30">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-primary">
            <span className="size-2 rounded-full bg-primary animate-pulse" />
            <span>جلسة تداول نشطة الآن</span>
          </div>
          <p className="text-xs text-muted-foreground">
            بدأت في {fmtDate(activeSession.started_at)} {activeSession.mood ? `· الحالة: ${activeSession.mood}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-left">
            <p className="text-[11px] text-muted-foreground">ربح / خسارة الجلسة</p>
            <p
              dir="ltr"
              className={`font-data text-lg font-bold ${
                sessionPnl > 0 ? "text-success" : sessionPnl < 0 ? "text-destructive" : "text-foreground"
              }`}
            >
              {fmtMoney(sessionPnl, currency)}
            </p>
          </div>
          <Button asChild size="sm" variant="secondary">
            <Link to="/session">
              <span>إدارة الجلسة</span>
              <ArrowRight className="size-3.5 mr-1" />
            </Link>
          </Button>
        </div>
      </div>

      {activeSession.plan && (
        <div className="rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-foreground/90">
          <span className="font-semibold text-primary block mb-1">الخطة المكتوبة للجلسة:</span>
          {activeSession.plan}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
        <span>نفذت خلال هذه الجلسة: <strong className="text-foreground">{sessionTradesCount}</strong> صفقات</span>
        <span className="flex items-center gap-1">
          <CheckCircle className="size-3 text-success" />
          تذكير: التزم بالأصول والفريمات المحددة بخطتك
        </span>
      </div>
    </div>
  );
}
