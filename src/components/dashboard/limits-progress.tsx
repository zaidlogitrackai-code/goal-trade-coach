import { Link } from "@tanstack/react-router";
import { AlertCircle, Sliders } from "lucide-react";
import { fmtMoney } from "@/lib/queries";
import { Progress } from "@/components/ui/progress";

interface LimitsProgressProps {
  todayPnl: number;
  dailyTarget: number;
  maxDailyProfit: number;
  maxDailyLoss: number;
  riskUsed: number;
  maxDailyRisk: number;
  tradesToday: number;
  maxTradesPerDay: number;
  consecutiveLosses: number;
  maxConsecutiveLosses: number;
  maxRiskPerTrade: number;
  currency: string;
}

export function LimitsProgress({
  todayPnl,
  dailyTarget,
  maxDailyProfit,
  maxDailyLoss,
  riskUsed,
  maxDailyRisk,
  tradesToday,
  maxTradesPerDay,
  consecutiveLosses,
  maxConsecutiveLosses,
  maxRiskPerTrade,
  currency,
}: LimitsProgressProps) {
  // Check for configuration contradictions
  const hasContradiction =
    (dailyTarget > 0 && maxDailyProfit > 0 && dailyTarget > maxDailyProfit) ||
    (maxRiskPerTrade > 0 && maxDailyRisk > 0 && maxRiskPerTrade > maxDailyRisk);

  return (
    <div className="panel space-y-5 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">حالة الحدود والالتزام</h2>
          <p className="text-xs text-muted-foreground">مؤشرات التقدم نحو أهدافك والمسافة المتبقية قبل خطوط الخطر الحمراء</p>
        </div>
        <Link
          to="/risk"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Sliders className="size-3.5" />
          <span>تعديل الحدود</span>
        </Link>
      </div>

      {hasContradiction && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/5 p-3.5 text-xs text-warning">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">تحتاج مراجعة إعدادات المخاطر</p>
            {maxRiskPerTrade > maxDailyRisk && maxDailyRisk > 0 && (
              <p>المخاطرة لكل صفقة ({fmtMoney(maxRiskPerTrade, currency)}) أعلى من إجمالي المخاطرة اليومية ({fmtMoney(maxDailyRisk, currency)}).</p>
            )}
            {dailyTarget > maxDailyProfit && maxDailyProfit > 0 && (
              <p>الهدف اليومي ({fmtMoney(dailyTarget, currency)}) أعلى من حد حماية الأرباح ({fmtMoney(maxDailyProfit, currency)}).</p>
            )}
          </div>
          <Link to="/risk" className="mr-auto underline font-medium">مراجعة الآن</Link>
        </div>
      )}

      <div className="space-y-4">
        {/* 1. Daily Target Progress */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-foreground font-medium">الهدف اليومي</span>
            <span className="font-data text-muted-foreground" dir="ltr">
              {dailyTarget > 0 ? `${fmtMoney(Math.max(0, todayPnl), currency)} / ${fmtMoney(dailyTarget, currency)} (${Math.min(100, Math.round((Math.max(0, todayPnl) / dailyTarget) * 100))}%)` : "غير مفعل"}
            </span>
          </div>
          {dailyTarget > 0 ? (
            <Progress value={Math.min(100, Math.max(0, (todayPnl / dailyTarget) * 100))} className="h-2" />
          ) : (
            <p className="text-[11px] text-muted-foreground italic">لم يتم تعيين هدف ربح يومي</p>
          )}
        </div>

        {/* 2. Daily Loss Limit */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-foreground font-medium">استهلاك حد الخسارة اليومية</span>
            <span className="font-data text-muted-foreground" dir="ltr">
              {maxDailyLoss > 0 ? `${fmtMoney(Math.max(0, -todayPnl), currency)} / ${fmtMoney(maxDailyLoss, currency)} (${Math.min(100, Math.round((Math.max(0, -todayPnl) / maxDailyLoss) * 100))}%)` : "غير مفعل"}
            </span>
          </div>
          {maxDailyLoss > 0 ? (
            <Progress
              value={Math.min(100, Math.max(0, (-todayPnl / maxDailyLoss) * 100))}
              className={`h-2 ${todayPnl < 0 && Math.abs(todayPnl) / maxDailyLoss >= 0.7 ? "[&>div]:bg-destructive" : ""}`}
            />
          ) : (
            <p className="text-[11px] text-muted-foreground italic">لم يتم تعيين حد أقصى للخسارة</p>
          )}
        </div>

        {/* 3. Daily Risk Limit */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-foreground font-medium">المخاطرة اليومية المستخدمة</span>
            <span className="font-data text-muted-foreground" dir="ltr">
              {maxDailyRisk > 0 ? `${fmtMoney(riskUsed, currency)} / ${fmtMoney(maxDailyRisk, currency)} (${Math.min(100, Math.round((riskUsed / maxDailyRisk) * 100))}%)` : "غير مفعل"}
            </span>
          </div>
          {maxDailyRisk > 0 ? (
            <Progress
              value={Math.min(100, Math.max(0, (riskUsed / maxDailyRisk) * 100))}
              className={`h-2 ${riskUsed / maxDailyRisk >= 0.8 ? "[&>div]:bg-destructive" : ""}`}
            />
          ) : (
            <p className="text-[11px] text-muted-foreground italic">لم يتم تعيين حد للمخاطرة اليومية</p>
          )}
        </div>

        {/* 4. Trades Limit */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-foreground font-medium">عدد الصفقات اليوم</span>
            <span className="font-data text-muted-foreground" dir="ltr">
              {maxTradesPerDay > 0 ? `${tradesToday} / ${maxTradesPerDay} (${Math.min(100, Math.round((tradesToday / maxTradesPerDay) * 100))}%)` : `${tradesToday} صفقات`}
            </span>
          </div>
          {maxTradesPerDay > 0 ? (
            <Progress
              value={Math.min(100, (tradesToday / maxTradesPerDay) * 100)}
              className={`h-2 ${tradesToday >= maxTradesPerDay ? "[&>div]:bg-warning" : ""}`}
            />
          ) : (
            <p className="text-[11px] text-muted-foreground italic">لم يتم تحديد حد لعدد الصفقات</p>
          )}
        </div>
      </div>
    </div>
  );
}
