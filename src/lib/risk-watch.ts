import { computeDayMetrics, type StatusSettings, type StatusTrade } from "./trading-status";

export interface WatchTrade extends StatusTrade {
  id: string;
  symbol: string;
  stop_loss: number | null;
}

export interface RiskAlert {
  /** Unique per user: the same alert is only sent once. */
  key: string;
  level: "danger" | "warning" | "success";
  title: string;
  body: string;
}

const LONG_OPEN_HOURS = 8;

function dayKey(now: Date) {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

/** Everything the risk guardian should warn about right now. Pure: no I/O. */
export function riskAlerts(s: StatusSettings, trades: WatchTrade[], now = new Date()): RiskAlert[] {
  const m = computeDayMetrics(s, trades, 0, now);
  const d = dayKey(now);
  const out: RiskAlert[] = [];
  const loss = -Math.min(0, m.todayPnl);

  if (s.max_daily_loss > 0) {
    if (loss >= s.max_daily_loss) {
      out.push({ key: `loss_hit:${d}`, level: "danger", title: "وقف، لا تتداول اليوم", body: `وصلت حد خسارتك اليومي (${s.max_daily_loss}). أقفل المنصة وارجع بكرة بعقل صافي.` });
    } else if (loss >= s.max_daily_loss * 0.8) {
      out.push({ key: `loss_80:${d}`, level: "warning", title: "قربت من حد الخسارة", body: `خسرت ${loss} من ${s.max_daily_loss}. باقي ${s.max_daily_loss - loss} بس. فكّر توقف الحين.` });
    }
  }
  if (s.daily_target > 0 && m.todayPnl >= s.daily_target) {
    out.push({ key: `target_day:${d}`, level: "success", title: "وصلت هدفك اليومي 🎯", body: "لا تطمع. اطلع من السوق، سكّر الشارت، وشوف حياتك." });
  }
  if ((s.weekly_target ?? 0) > 0 && m.weekPnl >= s.weekly_target!) {
    out.push({ key: `target_week:${d.slice(0, 7)}:${Math.floor(now.getDate() / 7)}`, level: "success", title: "تحقق هدفك الأسبوعي", body: "خلّص أسبوعك هنا، لا تطمع." });
  }
  if ((s.monthly_target ?? 0) > 0 && m.monthPnl >= s.monthly_target!) {
    out.push({ key: `target_month:${now.getFullYear()}-${now.getMonth() + 1}`, level: "success", title: "تحقق هدفك الشهري", body: "شهر ناجح. حافظ على أرباحك ولا تطمع." });
  }
  if (m.consecutiveLosses >= 2) {
    out.push({ key: `streak${m.consecutiveLosses}:${d}`, level: "warning", title: "خسارتين ورا بعض", body: "خذ استراحة الحين. لا تدخل صفقة تعويض." });
  }
  if (s.max_trades_per_day > 0 && m.tradesToday > s.max_trades_per_day) {
    out.push({ key: `overtrade:${d}`, level: "danger", title: "تجاوزت عدد الصفقات", body: `دخلت ${m.tradesToday} صفقات والحد ${s.max_trades_per_day}. وقف تداول اليوم.` });
  }
  for (const t of trades) {
    if (t.status !== "open") continue;
    if (!t.stop_loss) {
      out.push({ key: `nosl:${t.id}`, level: "danger", title: `حط وقف الخسارة على ${t.symbol}`, body: "صفقتك مفتوحة بدون وقف. حطه الحين قبل لا تكبر الخسارة." });
    }
    if (now.getTime() - new Date(t.opened_at).getTime() > LONG_OPEN_HOURS * 3_600_000) {
      out.push({ key: `longopen:${t.id}`, level: "warning", title: `صفقة ${t.symbol} مفتوحة من وقت طويل`, body: "راجعها: إذا فكرتها انتهت أقفلها." });
    }
  }
  return out;
}

/** Next time a daily reminder at HH:MM fires after `from`. */
export function nextDaily(at: string, from = new Date()): Date {
  const [h, mi] = at.split(":").map(Number);
  const d = new Date(from);
  d.setHours(h ?? 9, mi ?? 0, 0, 0);
  if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 1);
  return d;
}
