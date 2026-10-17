/**
 * Decides which pages the sidebar puts first, which it tucks under "المزيد",
 * and which five the mobile bar shows, from what the trader has actually done.
 */
export type NavPath =
  | "/dashboard"
  | "/session"
  | "/new-trade"
  | "/trades"
  | "/analyst"
  | "/coach"
  | "/strategies"
  | "/training"
  | "/risk"
  | "/discipline"
  | "/performance"
  | "/reports"
  | "/rules"
  | "/knowledge"
  | "/settings";

export type NavState = {
  strategies: number;
  rules: number;
  trades: number;
  closed: number;
  notes: number;
  activeSession: boolean;
  violationsWeek: number;
  /** Trading is blocked today (limit hit, cooldown, paused). */
  blocked: boolean;
  /** Page of the client's current step (journey.ts); always pinned first. */
  nextStep?: NavPath | null;
};

export type NavPlan = { pinned: NavPath[]; more: NavPath[]; mobile: NavPath[] };

export function planNav(s: NavState | null): NavPlan {
  if (!s)
    return {
      pinned: [],
      more: [],
      mobile: ["/dashboard", "/session", "/new-trade", "/trades", "/risk"],
    };

  const want: NavPath[] = [];
  if (s.nextStep && s.nextStep !== "/dashboard") want.push(s.nextStep);
  if (s.blocked) want.push(s.violationsWeek > 0 ? "/discipline" : "/trades", "/coach");
  else if (s.activeSession) want.push("/new-trade", "/session");
  else want.push("/session");
  if (s.strategies === 0) want.push("/strategies");
  if (s.rules === 0) want.push("/rules");
  if (s.violationsWeek > 0) want.push("/discipline");
  want.push("/coach");
  if (s.closed >= 5) want.push("/reports");
  const pinned = [...new Set(want)].slice(0, 4);

  const dormant: NavPath[] = [];
  if (s.trades === 0) dormant.push("/trades", "/discipline");
  if (s.closed < 3) dormant.push("/performance", "/reports");
  const more = [...new Set(dormant)].filter((p) => !pinned.includes(p));

  const mobile = [
    ...new Set<NavPath>(["/dashboard", ...pinned, "/new-trade", "/trades", "/risk"]),
  ].slice(0, 5);
  return { pinned, more, mobile };
}
