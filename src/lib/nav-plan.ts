import { HOME, TABS, type NavPath } from "./nav-registry";

/**
 * Marks the page of the trader's current step (journey.ts) with a dot on its tab, its
 * «المزيد» row and its sidebar link. Marked, never moved: every page keeps its place from
 * nav-registry.ts, so the thumb finds it where it was yesterday.
 */
export type NavState = { nextStep?: NavPath | null };

export type NavPlan = {
  next: NavPath | null;
  /** The marked page lives in the «المزيد» sheet, so the sheet's own button carries the dot. */
  inMore: boolean;
};

export function planNav(s: NavState | null): NavPlan {
  // Home lists the steps itself; a dot on it would point nowhere new.
  const next = s?.nextStep && s.nextStep !== HOME ? s.nextStep : null;
  return { next, inMore: next != null && !TABS.some((t) => t.path === next) };
}
