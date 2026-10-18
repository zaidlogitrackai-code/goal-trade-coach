import { Link, useCanGoBack, useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ChevronRight, LogOut, Menu, Settings } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { NotificationsBell } from "@/components/notifications-bell";
import { RiskWatcher } from "@/components/risk-watcher";
import { NotificationSound } from "@/components/notification-sound";
import { VisitRecorder } from "@/components/visit-recorder";
import { useJourney } from "@/lib/use-journey";
import { planNav, type NavPlan } from "@/lib/nav-plan";
import { backTarget, MORE, navEntry, SIDEBAR, TABS, type NavEntry } from "@/lib/nav-registry";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { useMediaQuery, WIDE_QUERY } from "@/hooks/use-media-query";
import { useVisualViewport } from "@/hooks/use-visual-viewport";

/** The page of the trader's current step gets a dot where it already sits (see nav-plan.ts). */
function useNavPlan(): NavPlan {
  const j = useJourney();
  return planNav(j ? { nextStep: j.journey.current?.to ?? null } : null);
}

function StepDot() {
  return (
    <>
      <span aria-hidden="true" className="absolute -end-1 -top-0.5 size-2 rounded-full bg-primary ring-2 ring-background" />
      <span className="sr-only">، خطوتك الحالية</span>
    </>
  );
}

function NavLink({ n, next }: { n: NavEntry; next: boolean }) {
  return (
    <Link
      to={n.path}
      className="flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
      activeProps={{ className: "bg-sidebar-accent text-foreground font-medium" }}
    >
      <span className="relative"><n.icon className="size-4" />{next && <StepDot />}</span>
      {n.label}
    </Link>
  );
}

/**
 * Asks first: on the Home Screen app a stray tap on logout means typing the email and password
 * again on the phone.
 */
function SignOutButton({ onConfirm, className }: { onConfirm: () => void; className: string }) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" className={className}>
          <LogOut className="size-4" /> تسجيل الخروج
        </Button>
      }
      title="متأكد بدك تطلع؟"
      description="بتحتاج تدخل إيميلك وكلمة السر من جديد عشان ترجع."
      cancelLabel="لا، خليني"
      confirmLabel="سجّل خروج"
      destructive
      onConfirm={onConfirm}
    />
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

/**
 * The phone's iOS-style nav bar: the page's large title from the registry, a back chevron on
 * every page that is not a tab (to the screen he came from, or home when the app opened right
 * there), and the trailing slots: the breaker chip (T14), the bell and a gear.
 */
export function NavBar({ pathname, bell }: { pathname: string; bell: boolean }) {
  const router = useRouter();
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const entry = navEntry(pathname);
  const back = backTarget(pathname);
  function goBack() {
    if (canGoBack) router.history.back();
    else if (back) void navigate({ to: back, replace: true });
  }
  return (
    <header className="mobile-header sticky top-0 z-30 flex items-center gap-1 bg-background px-2 lg:hidden">
      {back && (
        <button
          type="button"
          onClick={goBack}
          aria-label="رجوع"
          className="-me-1 grid size-11 shrink-0 place-items-center rounded-full text-foreground transition-transform duration-200 ease-ios active:scale-92 active:bg-accent"
        >
          {/* Right to left, back points right: the side the screen came in from. */}
          <ChevronRight className="size-7" strokeWidth={2.25} aria-hidden="true" />
        </button>
      )}
      <p className={`min-w-0 flex-1 truncate font-display text-[1.625rem] font-bold leading-normal text-foreground ${back ? "" : "ps-2"}`}>
        {entry?.title}
      </p>
      <div className="flex shrink-0 items-center">
        {bell && <NotificationsBell />}
        <Link
          to="/settings"
          aria-label="الإعدادات"
          className="grid size-11 place-items-center rounded-full text-muted-foreground transition-colors active:bg-accent"
          activeProps={{ className: "text-foreground" }}
        >
          <Settings className="size-5" aria-hidden="true" />
        </Link>
      </div>
    </header>
  );
}

const TAB_CLASS = "relative flex h-[3.25rem] min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[10px] transition-transform duration-200 ease-ios active:scale-92";
const TAB_ACTIVE = "bg-foreground/15 text-foreground font-semibold shadow-[inset_0_1px_0_var(--glass-highlight)]";

export function AppShell({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const plan = useNavPlan();
  // The sidebar exists only from lg up, so only one bell is mounted: one query, one greeting.
  const wide = useMediaQuery(WIDE_QUERY);
  const [moreOpen, setMoreOpen] = useState(false);
  const inMorePage = !navEntry(pathname)?.tabRoot;
  // --vvh and html[data-kb] for every page: chat frames and sheets fit above the keyboard.
  useVisualViewport();
  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-dvh">
      <RiskWatcher />
      <NotificationSound />
      <VisitRecorder />
      {wide && <aside className="glass-strong sticky top-3 m-3 flex h-[calc(100dvh-1.5rem)] w-64 shrink-0 flex-col rounded-[2rem] p-4">
        <div className="flex items-center justify-between"><Logo /><NotificationsBell /></div>

        <nav className="mt-5 flex-1 space-y-4 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SIDEBAR.map((group) => (
            <div key={group.id} className="space-y-1">
              <p className="px-3 text-xs font-semibold text-muted-foreground/70">{group.title}</p>
              <div className="space-y-0.5">
                {group.items.map((n) => (
                  <NavLink key={n.path} n={n} next={plan.next === n.path} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <SignOutButton onConfirm={signOut} className="mt-2 w-full justify-start gap-3 px-3 text-muted-foreground" />
        <p className="mt-2 text-center text-xs text-muted-foreground">انضباط. استراتيجية. حرية.</p>
      </aside>}

      <div className="flex min-w-0 flex-1 flex-col">
        <NavBar pathname={pathname} bell={!wide} />
        {/* Keyed by route so each screen enters with the same soft iOS motion */}
        <main className="pb-tab-bar flex-1 px-4 pt-3 lg:px-10 lg:pb-10 lg:pt-6">
          <div key={pathname} className="page-enter">{children}</div>
        </main>
      </div>

      <nav data-tabbar className="glass-strong tab-bar-bottom fixed inset-x-3 z-40 grid h-[4.25rem] grid-cols-5 items-center rounded-[2rem] px-1.5 lg:hidden" aria-label="التنقل الرئيسي">
        {TABS.map((n) => (
          <Link key={n.path} to={n.path} className={`${TAB_CLASS} text-muted-foreground`} activeProps={{ className: TAB_ACTIVE }}>
            <span className="relative"><n.icon className="size-5" />{plan.next === n.path && <StepDot />}</span>
            <span className="w-full truncate text-center">{n.label}</span>
          </Link>
        ))}
        <ResponsiveSheet
          open={moreOpen}
          onOpenChange={setMoreOpen}
          title="كل الأقسام"
          trigger={
            <Button variant="ghost" className={`${TAB_CLASS} ${inMorePage ? TAB_ACTIVE : "text-muted-foreground"}`}>
              <span className="relative"><Menu className="size-5" />{plan.inMore && <StepDot />}</span>
              <span>المزيد</span>
            </Button>
          }
        >
          <div className="space-y-5">
            {MORE.map((group) => (
              <section key={group.id} aria-label={group.title}>
                <h3 className="mb-2 px-1 text-xs font-semibold text-muted-foreground">{group.title}</h3>
                <div className="grid grid-cols-2 gap-2">
                  {group.items.map((n) => (
                    <Link
                      key={n.path}
                      to={n.path}
                      preload={false}
                      onClick={() => setMoreOpen(false)}
                      className="flex min-h-12 min-w-0 items-center gap-3 rounded-2xl border border-border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground active:bg-accent"
                      activeProps={{ className: "border-foreground/30 text-foreground" }}
                    >
                      <span className="relative shrink-0"><n.icon className="size-4" />{plan.next === n.path && <StepDot />}</span>
                      <span className="line-clamp-2 leading-normal">{n.label}</span>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <SignOutButton onConfirm={signOut} className="mt-6 h-11 w-full justify-center gap-2 text-muted-foreground" />
        </ResponsiveSheet>
      </nav>
    </div>
  );
}

/**
 * A page's heading row. On the phone the nav bar already shows the page's title, so here it
 * is for screen readers only and just the subtitle and action stay; from lg up, where there
 * is no nav bar, it shows in full.
 */
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
    <div className={`mb-5 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 sm:mb-6 ${subtitle || action ? "" : "max-lg:sr-only"}`}>
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold text-foreground max-lg:sr-only lg:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-xs text-muted-foreground max-lg:mt-0 sm:text-sm">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * The one header row of every agent chat: its status line and its buttons. The title comes
 * from the registry and, like PageHeader's, shows only from lg up; on the phone the nav bar
 * carries it, so a chat never stacks two headers above its messages.
 */
export function ChatHeader({ status, actions }: { status?: ReactNode; actions?: ReactNode }) {
  const { pathname } = useLocation();
  const entry = navEntry(pathname);
  const Icon = entry?.icon;
  return (
    <div className="mb-2 flex min-h-11 shrink-0 items-center gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {Icon && <Icon className="size-5 shrink-0 max-lg:hidden" aria-hidden="true" />}
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-xl font-semibold max-lg:sr-only">{entry?.title}</h1>
          {status && <div className="truncate text-xs text-muted-foreground">{status}</div>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
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
