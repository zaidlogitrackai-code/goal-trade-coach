import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  LayoutDashboard, Timer, PlusCircle, ListOrdered, ScanSearch, MessagesSquare, Layers,
  ShieldCheck, Gauge, LineChart, FileText, ScrollText, BookOpen, Settings, LogOut,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import logoHadi from "@/assets/logo-hadi.png";

export const NAV = [
  { to: "/dashboard", label: "الرئيسية", icon: LayoutDashboard },
  { to: "/session", label: "جلسة التداول", icon: Timer },
  { to: "/new-trade", label: "الصفقة الجديدة", icon: PlusCircle },
  { to: "/trades", label: "سجل الصفقات", icon: ListOrdered },
  { to: "/analyst", label: "المحلل الذكي", icon: ScanSearch },
  { to: "/coach", label: "المدرب الذكي", icon: MessagesSquare },
  { to: "/strategies", label: "استراتيجياتي", icon: Layers },
  { to: "/risk", label: "إدارة المخاطر", icon: ShieldCheck },
  { to: "/discipline", label: "الانضباط والطمع", icon: Gauge },
  { to: "/performance", label: "الأداء", icon: LineChart },
  { to: "/reports", label: "التقارير", icon: FileText },
  { to: "/rules", label: "القواعد", icon: ScrollText },
  { to: "/knowledge", label: "مركز المعرفة", icon: BookOpen },
  { to: "/settings", label: "الإعدادات", icon: Settings },
] as const;

const MOBILE = ["/dashboard", "/new-trade", "/trades", "/risk", "/settings"];

export function Logo() {
  return (
    <img src={logoHadi} alt="Hadi Alajmi — Trading OS" className="h-10 w-auto" loading="lazy" width={714} height={552} />
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-l border-sidebar-border bg-sidebar/90 p-4 lg:flex">
        <Logo />
        <nav className="mt-8 flex-1 space-y-1 overflow-y-auto">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              activeProps={{ className: "bg-sidebar-accent text-foreground font-medium" }}
            >
              <n.icon className="size-4" />
              {n.label}
            </Link>
          ))}
        </nav>
        <button onClick={signOut} className="mt-4 flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
          <LogOut className="size-4" /> تسجيل الخروج
        </button>
        <p className="mt-4 text-center text-[10px] tracking-[0.2em] text-muted-foreground">انضباط. استراتيجية. حرية.</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-3 lg:hidden">
          <Logo />
          <button onClick={signOut} aria-label="تسجيل الخروج" className="text-muted-foreground"><LogOut className="size-5" /></button>
        </header>
        <main className="flex-1 px-4 pb-28 pt-6 lg:px-10 lg:pb-10">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-sidebar/95 backdrop-blur lg:hidden">
        {NAV.filter((n) => MOBILE.includes(n.to)).map((n) => (
          <Link key={n.to} to={n.to} className="flex flex-col items-center gap-1 py-2.5 text-[11px] text-muted-foreground" activeProps={{ className: "text-primary" }}>
            <n.icon className="size-5" />
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold lg:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title = "لا توجد بيانات بعد", text = "ابدأ بإعداد نظام التداول الخاص بك.", action }: { title?: string; text?: string; action?: ReactNode }) {
  return (
    <div className="panel flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="mb-2 size-12 rounded-full bg-accent" />
      <p className="font-display text-lg font-semibold">{title}</p>
      <p className="text-sm text-muted-foreground">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "success" | "destructive" | "warning" | undefined }) {
  const color = tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <div className="panel p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-data mt-2 text-xl font-semibold ${color}`} dir="ltr" style={{ textAlign: "right" }}>{value}</p>
    </div>
  );
}

export function Loading() {
  return <div className="py-20 text-center text-sm text-muted-foreground">جارٍ التحميل…</div>;
}
