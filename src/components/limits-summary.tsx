import { AlertTriangle } from "lucide-react";
import { fmtMoney, type Settings } from "@/lib/queries";
import { validateRiskSettings, type RiskSettingsInput } from "@/lib/risk-validation";

const ROWS: [keyof Settings, string][] = [
  ["daily_target", "هدف اليوم"],
  ["max_daily_profit", "سقف الربح اليومي"],
  ["max_daily_loss", "أقصى خسارة يومية"],
  ["max_risk_per_trade", "مخاطرة الصفقة"],
  ["max_daily_risk", "المخاطرة اليومية"],
  ["weekly_target", "هدف الأسبوع"],
  ["weekly_max_loss", "خسارة الأسبوع"],
  ["monthly_target", "هدف الشهر"],
  ["monthly_max_loss", "خسارة الشهر"],
];

/** Read-only view of the live limits; changes happen only by talking to the risk guardian. */
export function LimitsSummary({ s }: { s: Settings & { current_balance?: number } }) {
  const bal = Number(s.current_balance ?? s.starting_balance) || 0;
  const cur = s.currency || "USD";
  const v = validateRiskSettings({ ...(s as unknown as RiskSettingsInput), starting_balance: bal });
  const issues = [...v.errors, ...v.warnings];
  return (
    <div className="panel space-y-3 p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">حدودك الحالية</h3>
        <span className="text-xs text-muted-foreground">رصيدك {fmtMoney(bal, cur)}</span>
      </div>
      <ul className="divide-y divide-border text-sm">
        {ROWS.map(([k, label]) => {
          const n = Number(s[k]) || 0;
          return (
            <li key={k} className="flex justify-between py-1.5">
              <span className="text-muted-foreground">{label}</span>
              <span>{n > 0 ? <>{fmtMoney(n, cur)}{bal > 0 && <span className="ms-1 text-xs text-muted-foreground">({((n / bal) * 100).toFixed(2)}%)</span>}</> : "—"}</span>
            </li>
          );
        })}
        <li className="flex justify-between py-1.5"><span className="text-muted-foreground">صفقات باليوم</span><span>{s.max_trades_per_day || "—"}</span></li>
        <li className="flex justify-between py-1.5"><span className="text-muted-foreground">خسائر متتالية</span><span>{s.max_consecutive_losses || "—"}</span></li>
      </ul>
      {issues.length > 0 && (
        <div className="rounded-xl border border-destructive/40 p-3 text-xs text-destructive">
          <p className="mb-1 flex items-center gap-1.5 font-medium"><AlertTriangle className="size-3.5" /> فيه تعارض — اكتب للحارس «صحّح التعارض»</p>
          <ul className="list-disc ps-4">{issues.map((i) => <li key={i.message}>{i.message}</li>)}</ul>
        </div>
      )}
      <p className="text-xs text-muted-foreground">تعديل الحدود يصير بالكلام مع الحارس، مثل: «خلّ المخاطرة اليومية 1%».</p>
    </div>
  );
}
