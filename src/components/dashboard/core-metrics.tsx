import { Link } from "@tanstack/react-router";
import { ArrowUpRight, TrendingUp, Shield, Activity, Flame } from "lucide-react";
import { fmtMoney } from "@/lib/queries";

interface CoreMetricsProps {
  todayPnl: number;
  dailyTarget: number;
  maxDailyProfit: number;
  maxDailyLoss: number;
  currency: string;
  riskRemaining: number | null;
  maxDailyRisk: number;
  tradesRemaining: number | null;
  maxTradesPerDay: number;
  tradesToday: number;
  consecutiveLosses: number;
  maxConsecutiveLosses: number;
}

export function CoreMetrics({
  todayPnl,
  dailyTarget,
  maxDailyProfit,
  maxDailyLoss,
  currency,
  riskRemaining,
  maxDailyRisk,
  tradesRemaining,
  maxTradesPerDay,
  tradesToday,
  consecutiveLosses,
  maxConsecutiveLosses,
}: CoreMetricsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* 1. Today PnL */}
      <Link
        to="/performance"
        className="panel group relative p-5 transition-colors hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-xs font-medium">ربح / خسارة اليوم</span>
          <TrendingUp className="size-4 group-hover:text-primary" />
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span
            dir="ltr"
            className={`font-data text-2xl font-bold sm:text-3xl ${
              todayPnl > 0 ? "text-success" : todayPnl < 0 ? "text-destructive" : "text-foreground"
            }`}
          >
            {fmtMoney(todayPnl, currency)}
          </span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {dailyTarget > 0 ? `الهدف: ${fmtMoney(dailyTarget, currency)}` : "لا يوجد هدف محدد"}
          {maxDailyLoss > 0 ? ` · أقصى خسارة: ${fmtMoney(maxDailyLoss, currency)}` : ""}
        </p>
        <div className="mt-3 flex items-center gap-1 text-[11px] font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
          <span>شاهد الأداء التفصيلي</span>
          <ArrowUpRight className="size-3" />
        </div>
      </Link>

      {/* 2. Remaining Risk */}
      <Link
        to="/risk"
        className="panel group relative p-5 transition-colors hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-xs font-medium">المخاطرة المتبقية</span>
          <Shield className="size-4 group-hover:text-primary" />
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span
            dir="ltr"
            className={`font-data text-2xl font-bold sm:text-3xl ${
              riskRemaining === 0 ? "text-destructive" : "text-foreground"
            }`}
          >
            {riskRemaining != null ? fmtMoney(riskRemaining, currency) : "غير محدد"}
          </span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {maxDailyRisk > 0 ? `من إجمالي ${fmtMoney(maxDailyRisk, currency)} اليوم` : "لم يتم تفعيل حد أقصى للمخاطرة"}
        </p>
        <div className="mt-3 flex items-center gap-1 text-[11px] font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
          <span>تعديل حدود المخاطر</span>
          <ArrowUpRight className="size-3" />
        </div>
      </Link>

      {/* 3. Remaining Trades */}
      <Link
        to="/trades"
        className="panel group relative p-5 transition-colors hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-xs font-medium">الصفقات المتبقية</span>
          <Activity className="size-4 group-hover:text-primary" />
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span
            dir="ltr"
            className={`font-data text-2xl font-bold sm:text-3xl ${
              tradesRemaining === 0 ? "text-warning" : "text-foreground"
            }`}
          >
            {tradesRemaining != null ? tradesRemaining : "مفتوح"}
          </span>
          {tradesRemaining != null && <span className="text-xs text-muted-foreground">صفقة</span>}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {maxTradesPerDay > 0
            ? `نفذت ${tradesToday} من أصل ${maxTradesPerDay} صفقات مسموحة`
            : `نفذت ${tradesToday} صفقة اليوم`}
        </p>
        <div className="mt-3 flex items-center gap-1 text-[11px] font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
          <span>عرض سجل الصفقات</span>
          <ArrowUpRight className="size-3" />
        </div>
      </Link>

      {/* 4. Consecutive Losses */}
      <Link
        to="/discipline"
        className="panel group relative p-5 transition-colors hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-xs font-medium">الخسائر المتتالية</span>
          <Flame className="size-4 group-hover:text-primary" />
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span
            dir="ltr"
            className={`font-data text-2xl font-bold sm:text-3xl ${
              consecutiveLosses >= maxConsecutiveLosses && maxConsecutiveLosses > 0
                ? "text-destructive"
                : consecutiveLosses > 0
                ? "text-warning"
                : "text-success"
            }`}
          >
            {consecutiveLosses}
          </span>
          <span className="text-xs text-muted-foreground">متتالية</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {maxConsecutiveLosses > 0
            ? `الحد الأقصى للتوقف: ${maxConsecutiveLosses} خسائر`
            : "لم يُحدد حد للخسائر المتتالية"}
        </p>
        <div className="mt-3 flex items-center gap-1 text-[11px] font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
          <span>فحص مؤشرات الانضباط</span>
          <ArrowUpRight className="size-3" />
        </div>
      </Link>
    </div>
  );
}
