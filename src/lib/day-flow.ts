import type { TradingStatus } from "./trading-status";

export type FlowStep = 1 | 2 | 3 | 4 | 5;
export const FLOW_LABELS = ["أهدافك", "ابدأ الجلسة", "الصفقات", "سكّر وراجع", "خلاص لليوم"] as const;

export interface FlowInput {
  hasGoals: boolean;
  status: TradingStatus;
  hasActiveSession: boolean;
  sessionEndedToday: boolean;
  openTradesWithoutStop: number;
}

export interface FlowResult {
  step: FlowStep;
  message: string;
  action: string;
  to: "/coach" | "/session" | "/new-trade" | "/trades" | "/performance";
  interview?: boolean;
  danger?: boolean;
}

/** One next step for today, picked from the user's own data. */
export function currentStep(i: FlowInput): FlowResult {
  if (!i.hasGoals)
    return { step: 1, message: "يا هادي، قبل كل شيء: كم تارقتك وكم أقصى خسارة تتحملها؟", action: "جاوب المدرب", to: "/coach", interview: true };
  if (i.sessionEndedToday && !i.hasActiveSession)
    return { step: 5, message: "خلصت يومك. ارتاح، والسوق باقي بكرة.", action: "شوف أداءك", to: "/performance" };
  if (!i.hasActiveSession)
    return { step: 2, message: "يا هادي، بتتداول اليوم؟ كم تارقتك؟", action: "ابدأ الجلسة مع المدرب", to: "/session" };
  if (i.status === "loss_limit")
    return { step: 4, message: "وصلت حد الخسارة. وقف الحين وسكّر الجلسة.", action: "سكّر الجلسة", to: "/session", danger: true };
  if (i.status === "target_hit")
    return { step: 4, message: "حققت هدفك. لا تطمع، سكّر الجلسة واحمِ ربحك.", action: "سكّر الجلسة", to: "/session" };
  if (i.status === "stopped")
    return { step: 4, message: "التداول موقوف اليوم. سكّر الجلسة وراجع.", action: "سكّر الجلسة", to: "/session", danger: true };
  if (i.openTradesWithoutStop > 0)
    return { step: 3, message: "عندك صفقة مفتوحة بدون وقف خسارة. حط الوقف الحين.", action: "شوف الصفقات", to: "/trades", danger: true };
  if (i.status === "high_risk" || i.status === "rules_broken")
    return { step: 3, message: "المخاطرة عالية. فكّر توقف أو خفّف الحجم.", action: "كلّم المدرب", to: "/coach", danger: true };
  return { step: 3, message: "الجلسة شغالة. ارفع صورة أو قل للمدرب صفقتك.", action: "صفقة جديدة", to: "/new-trade" };
}
