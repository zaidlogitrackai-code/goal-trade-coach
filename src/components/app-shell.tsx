import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  LayoutDashboard, Timer, PlusCircle, ListOrdered, ScanSearch, MessagesSquare, Layers,
  ShieldCheck, Gauge, LineChart, FileText, ScrollText, BookOpen, Settings, LogOut, ChevronDown, Menu,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { NotificationsBell } from "@/components/notifications-bell";
import { RiskWatcher } from "@/components/risk-watcher";
import { activeSessionQuery, tradesQuery, violationsQuery } from "@/lib/queries";
import { isBlocked, useJourney } from "@/lib/use-journey";
import { HIDDEN_NOTES } from "@/lib/hidden-notes";
import { planNav, type NavPath, type NavPlan } from "@/lib/nav-plan";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export const NAV_GROUPS = [
  {
    title: "التداول",
    items: [
      { to: "/dashboard", label: "الرئيسية", icon: LayoutDashboard },
      { to: "/session", label: "جلسة التداول", icon: Timer },
      { to: "/new-trade", label: "صفقة جديدة", icon: PlusCircle },
      { to: "/trades", label: "سجل الصفقات", icon: ListOrdered },
    ],
  },
  {
    title: "التحليل",
    items: [
      { to: "/analyst", label: "المحلل الذكي", icon: ScanSearch },
      { to: "/coach", label: "سَنَد", icon: MessagesSquare },
      { to: "/strategies", label: "الاستراتيجيات", icon: Layers },
    ],
  },
  {
    title: "الانضباط",
    items: [
      { to: "/risk", label: "إدارة المخاطر", icon: ShieldCheck },
      { to: "/discipline", label: "الانضباط والطمع", icon: Gauge },
      { to: "/performance", label: "الأداء", icon: LineChart },
      { to: "/reports", label: "التقارير", icon: FileText },
    ],
  },
  {
    title: "المعرفة",
    items: [
      { to: "/rules", label: "القواعد", icon: ScrollText },
      { to: "/knowledge", label: "مركز المعرفة", icon: BookOpen },
    ],
  },
  {
    title: "النظام",
    items: [
      { to: "/settings", label: "الإعدادات", icon: Settings },
    ],
  },
] as const;

type NavItem = (typeof NAV_GROUPS)[number]["items"][number];
export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => [...g.items] as NavItem[]);

const ITEM = Object.fromEntries(NAV.map((n) => [n.to, n])) as Record<NavPath, NavItem>;

const MOBILE_NAV: NavItem[] = [
  ITEM["/dashboard"],
  ITEM["/session"],
  ITEM["/new-trade"],
  ITEM["/coach"],
];

/** Reorders the menu around what the trader is doing and has set up (see nav-plan.ts). */
function useNavPlan(): NavPlan {
  const t = useQuery(tradesQuery);
  const v = useQuery(violationsQuery);
  const a = useQuery(activeSessionQuery);
  const j = useJourney();
  const notes = useQuery({
    queryKey: ["notes", "count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("knowledge_notes")
        .select("id", { count: "exact", head: true })
        .not("category", "in", HIDDEN_NOTES);
      if (error) throw error;
      return count ?? 0;
    },
  });
  if (!j || !t.data || !v.data || a.isLoading || notes.data == null) return planNav(null);

  const week = Date.now() - 7 * 86_400_000;
  const step = (k: string) => j.journey.steps.find((x) => x.key === k)?.done;
  return planNav({
    strategies: step("strategy") ? 1 : 0,
    rules: step("rules") ? 1 : 0,
    trades: t.data.length,
    closed: t.data.filter((x) => x.status === "closed").length,
    notes: notes.data,
    activeSession: !!a.data,
    violationsWeek: v.data.filter((x) => new Date(x.occurred_at).getTime() >= week).length,
    blocked: isBlocked(j.status),
    nextStep: j.journey.current?.to ?? null,
  });
}

function NavLink({ n, pinned }: { n: NavItem; pinned?: boolean }) {
  return (
    <Link
      to={n.to}
      className={`flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-sidebar-accent hover:text-foreground ${pinned ? "text-foreground" : "text-muted-foreground"}`}
      activeProps={{ className: "bg-sidebar-accent text-foreground font-medium" }}
    >
      <n.icon className={`size-4 ${pinned ? "text-primary" : ""}`} />
      {n.label}
    </Link>
  );
}

export function LogoMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="currentColor" aria-hidden="true">
      <rect x="9" y="10" width="2.5" height="28" rx="1" opacity=".55" />
      <rect x="5" y="18" width="10" height="13" rx="2" opacity=".55" />
      <rect x="22.75" y="5" width="2.5" height="34" rx="1" opacity=".75" />
      <rect x="19" y="14" width="10" height="17" rx="2" opacity=".75" />
      <rect x="36.5" y="2" width="2.5" height="38" rx="1" />
      <rect x="33" y="8" width="10" height="22" rx="2" />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <div dir="ltr" role="img" aria-label="Hadi Alajmi — Trading OS" className={`inline-flex items-center gap-2.5 text-foreground ${className}`}>
      <LogoMark className="h-8 w-8 shrink-0" />
      <span className="flex flex-col leading-none">
        <span className="text-xl font-bold tracking-[0.28em]">HADI</span>
        <span className="mt-1 text-[9px] font-medium uppercase tracking-[0.32em] text-muted-foreground">Trading OS</span>
      </span>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const plan = useNavPlan();
  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen">
      <RiskWatcher />
      <aside className="glass-strong sticky top-3 m-3 hidden h-[calc(100vh-1.5rem)] w-64 shrink-0 flex-col rounded-[2rem] p-4 lg:flex">
        <div className="flex items-center justify-between"><Logo /><NotificationsBell /></div>
        
        <nav className="mt-5 flex-1 space-y-4 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {plan.pinned.length > 0 && (
            <div className="space-y-1 rounded-lg bg-primary/5 py-2">
              <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-primary/80">لك الآن</p>
              <div className="space-y-0.5">
                {plan.pinned.map((p) => (
                  <NavLink key={p} n={ITEM[p]} pinned />
                ))}
              </div>
            </div>
          )}
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((n) => !plan.pinned.includes(n.to) && !plan.more.includes(n.to));
            if (items.length === 0) return null;
            return (
              <div key={group.title} className="space-y-1">
                <p className="px-3 text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
                  {group.title}
                </p>
                <div className="space-y-0.5">
                  {items.map((n) => (
                    <NavLink key={n.to} n={n} />
                  ))}
                </div>
              </div>
            );
          })}
          {plan.more.length > 0 && (
            <details className="group space-y-1" open={plan.more.some((p) => pathname.startsWith(p))}>
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 [&::-webkit-details-marker]:hidden">
                المزيد
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-0.5">
                {plan.more.map((p) => (
                  <NavLink key={p} n={ITEM[p]} />
                ))}
              </div>
            </details>
          )}
        </nav>

        <Button onClick={signOut} variant="ghost" className="mt-2 w-full justify-start gap-3 px-3 text-muted-foreground">
          <LogOut className="size-4" /> تسجيل الخروج
        </Button>
        <p className="mt-2 text-center text-[10px] tracking-[0.2em] text-muted-foreground">انضباط. استراتيجية. حرية.</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="grid h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 lg:hidden">
          <Logo className="min-w-0 scale-90 origin-right" />
          <div className="flex shrink-0 items-center gap-1">
            <div className="grid size-9 place-items-center"><NotificationsBell /></div>
            <Button onClick={signOut} aria-label="تسجيل الخروج" title="تسجيل الخروج" variant="ghost" size="icon" className="text-muted-foreground">
              <LogOut className="size-5" />
            </Button>
          </div>
        </header>
        {/* Keyed by route so each screen enters with the same soft iOS motion */}
        <main className="flex-1 px-4 pb-28 pt-3 lg:px-10 lg:pb-10 lg:pt-6">
          <div key={pathname} className="page-enter">{children}</div>
        </main>
      </div>

      <nav className="glass-strong fixed inset-x-3 bottom-3 z-40 grid h-[4.25rem] grid-cols-5 items-center rounded-[2rem] px-1.5 lg:hidden" aria-label="التنقل الرئيسي">
        {MOBILE_NAV.map((n) => (
          <Link key={n.to} to={n.to} className="flex h-[3.25rem] min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[10px] text-muted-foreground transition-transform duration-200 ease-ios active:scale-92" activeProps={{ className: "bg-foreground/15 text-foreground font-semibold shadow-[inset_0_1px_0_var(--glass-highlight)]" }}>
            <n.icon className="size-5" />
            <span className="w-full truncate text-center">{n.label}</span>
          </Link>
        ))}
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" className={`h-[3.25rem] min-w-0 flex-col gap-1 rounded-2xl px-1 text-[10px] transition-transform duration-200 ease-ios active:scale-92 ${MOBILE_NAV.some((n) => pathname.startsWith(n.to)) ? "text-muted-foreground" : "text-foreground"}`}>
              <Menu className="size-5" />
              <span>المزيد</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="ios-ease max-h-[78vh] overflow-y-auto overscroll-contain rounded-t-[2rem] border-border bg-card p-5 pb-8 shadow-none [background-image:none] [will-change:transform] data-[state=closed]:!duration-200 data-[state=open]:!duration-350 [&>button]:left-4 [&>button]:right-auto" dir="rtl">
            <SheetHeader className="mb-5 text-right">
              <SheetTitle>كل الأقسام</SheetTitle>
            </SheetHeader>
            <div className="grid grid-cols-2 gap-2">
              {NAV.filter((n) => !MOBILE_NAV.some((fixed) => fixed.to === n.to)).map((n) => (
                <SheetClose key={n.to} asChild>
                  <Link
                    to={n.to}
                    preload={false}
                    className="flex min-w-0 items-center gap-3 rounded-2xl border border-border bg-secondary/40 px-3 py-3 text-sm text-muted-foreground"
                    activeProps={{ className: "border-foreground/30 text-foreground" }}
                  >
                    <n.icon className="size-4 shrink-0" />
                    <span className="truncate">{n.label}</span>
                  </Link>
                </SheetClose>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </nav>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 sm:mb-6">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold text-foreground lg:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "success" | "warning" | "destructive" | undefined;
}) {
  const toneClasses = {
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
  };
  return (
    <div className="panel p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-data mt-2 text-2xl font-bold ${tone ? toneClasses[tone] : "text-foreground"}`} dir="ltr">
        {value}
      </p>
    </div>
  );
}

export function Loading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

export function EmptyState({
  title = "لا توجد بيانات",
  text = "لا توجد بيانات لعرضها هنا حالياً.",
  action,
}: {
  title?: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel flex flex-col items-center justify-center p-8 text-center sm:p-12">
      <h3 className="font-semibold text-lg">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
