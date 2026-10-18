/**
 * Where tapping a bell notification takes the trader. Pure: kind and dedupe_key are all
 * the bell knows, and the writers own the key formats (risk-watch.ts, risk-watcher.tsx,
 * ai.functions.ts riskMorning/disciplineMorning/morningGreeting/eveningReview).
 */
export type NotificationTarget =
  | { to: "/trades"; search: { trade: string }; label: string }
  | { to: "/dashboard" | "/session" | "/risk" | "/discipline"; label: string };

const HOME: NotificationTarget = { to: "/dashboard", label: "افتح الرئيسية" };

/** Alerts about one trade carry its id: `nosl:<id>`, `longopen:<id>`. */
const TRADE_KEY = /^(?:nosl|longopen):(.+)$/;

export function notificationTarget(kind: string | null | undefined, dedupeKey: string | null | undefined): NotificationTarget {
  const key = dedupeKey ?? "";
  const trade = TRADE_KEY.exec(key)?.[1];
  if (trade) return { to: "/trades", search: { trade }, label: "افتح الصفقة" };
  // The guardians' daily notes live in their own chats, not on the dashboard.
  if (key.startsWith("risk-morning-")) return { to: "/risk", label: "افتح إدارة المخاطر" };
  if (key.startsWith("discipline-morning-")) return { to: "/discipline", label: "افتح الانضباط" };
  switch (kind) {
    case "risk":
      // Limits, targets, loss streaks and over-trading are all read off the dashboard.
      return HOME;
    case "reminder":
      // Reminders the agents set are listed (and removed) on the risk page.
      return { to: "/risk", label: "افتح التذكيرات" };
    case "morning":
    case "evening":
      return { to: "/session", label: "افتح الجلسة" };
    default:
      return HOME;
  }
}
