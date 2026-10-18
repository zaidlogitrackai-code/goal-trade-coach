import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Brain,
  FileText,
  Gauge,
  Layers,
  LayoutDashboard,
  LineChart,
  ListOrdered,
  MessagesSquare,
  PlusCircle,
  ScanSearch,
  ScrollText,
  Settings,
  ShieldCheck,
  Timer,
} from "lucide-react";
import type { FileRouteTypes } from "@/routeTree.gen";

/**
 * Every page of the signed-in shell, in one place: the tab bar, the «المزيد» sheet, the
 * desktop sidebar, the nav bar's title and its back chevron all read this, so they can
 * never disagree, and a page missing here would be unreachable on the phone.
 */

/** Pages with their own chrome (landing, login, the setup flow), outside the shell's menus. */
type Unlisted = "/" | "/auth" | "/onboarding";
export type NavPath = Exclude<FileRouteTypes["to"], Unlisted>;

export type NavGroup = "today" | "review" | "setup" | "system";

/** Step order: the trader's day, looking back at it, the setup behind it, then the app itself. */
export const NAV_GROUPS: readonly { id: NavGroup; title: string }[] = [
  { id: "today", title: "اليوم" },
  { id: "review", title: "المراجعة" },
  { id: "setup", title: "الإعداد" },
  { id: "system", title: "النظام" },
];

export type NavEntry = {
  path: NavPath;
  /** The nav bar's large title on the phone. */
  title: string;
  /** The short name on a tab, in the «المزيد» sheet and in the sidebar. */
  label: string;
  icon: LucideIcon;
  group: NavGroup;
  /** A tab-bar destination: the top of its own stack, so no back chevron. */
  tabRoot: boolean;
};

export const HOME: NavPath = "/dashboard";

// A Record, so tsc refuses a new route until it has an entry. Key order is the menu order:
// the tabs keep their places, and each group lists its pages in the order of the steps.
const ENTRIES: Record<NavPath, Omit<NavEntry, "path">> = {
  "/dashboard": { title: "يومك", label: "الرئيسية", icon: LayoutDashboard, group: "today", tabRoot: true },
  "/session": { title: "جلسة التداول", label: "جلسة التداول", icon: Timer, group: "today", tabRoot: true },
  "/new-trade": { title: "الصفقة الجديدة", label: "صفقة جديدة", icon: PlusCircle, group: "today", tabRoot: true },
  "/coach": { title: "سَنَد", label: "سَنَد", icon: MessagesSquare, group: "today", tabRoot: true },
  "/risk": { title: "حارس المخاطر", label: "إدارة المخاطر", icon: ShieldCheck, group: "today", tabRoot: false },
  "/discipline": { title: "حارس الانضباط", label: "الانضباط والطمع", icon: Gauge, group: "today", tabRoot: false },
  "/analyst": { title: "المحلل الذكي", label: "المحلل الذكي", icon: ScanSearch, group: "today", tabRoot: false },
  "/trades": { title: "سجل الصفقات", label: "سجل الصفقات", icon: ListOrdered, group: "review", tabRoot: false },
  "/performance": { title: "الأداء", label: "الأداء", icon: LineChart, group: "review", tabRoot: false },
  "/reports": { title: "التقارير", label: "التقارير", icon: FileText, group: "review", tabRoot: false },
  "/strategies": { title: "مدرّب الاستراتيجية", label: "الاستراتيجيات", icon: Layers, group: "setup", tabRoot: false },
  "/training": { title: "تدريب الذكاء", label: "تدريب الذكاء", icon: Brain, group: "setup", tabRoot: false },
  "/rules": { title: "القواعد", label: "القواعد", icon: ScrollText, group: "setup", tabRoot: false },
  "/knowledge": { title: "مركز المعرفة", label: "مركز المعرفة", icon: BookOpen, group: "setup", tabRoot: false },
  "/settings": { title: "الإعدادات", label: "الإعدادات", icon: Settings, group: "system", tabRoot: false },
};

export const NAV: readonly NavEntry[] = (Object.keys(ENTRIES) as NavPath[]).map((path) => ({
  path,
  ...ENTRIES[path],
}));

export type NavSection = { id: NavGroup; title: string; items: NavEntry[] };

function sections(keep: (n: NavEntry) => boolean): NavSection[] {
  return NAV_GROUPS.map((g) => ({ ...g, items: NAV.filter((n) => n.group === g.id && keep(n)) })).filter(
    (g) => g.items.length > 0,
  );
}

/** The fixed tabs, in their fixed places. */
export const TABS: readonly NavEntry[] = NAV.filter((n) => n.tabRoot);
/** The «المزيد» sheet: every page that is not a tab, grouped in step order. */
export const MORE: readonly NavSection[] = sections((n) => !n.tabRoot);
/** The desktop sidebar: every page, grouped in step order. */
export const SIDEBAR: readonly NavSection[] = sections(() => true);

/** The page a pathname belongs to ("/trades/" and nested paths included); null outside the shell. */
export function navEntry(pathname: string): NavEntry | null {
  return NAV.find((n) => pathname === n.path || pathname.startsWith(`${n.path}/`)) ?? null;
}

/**
 * Where the back chevron goes when there is no earlier screen in this app to return to (the
 * Home Screen app opened right on the page, a reload): home. A tab is the top of its own
 * stack, so it has no chevron at all (null).
 */
export function backTarget(pathname: string): NavPath | null {
  return navEntry(pathname)?.tabRoot ? null : HOME;
}
