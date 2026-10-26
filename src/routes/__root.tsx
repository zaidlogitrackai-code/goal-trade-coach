import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { InstallApp } from "@/components/install-app";
import { supabase } from "@/integrations/supabase/client";
import { THEME_BOOT_SCRIPT, THEME_COLOR } from "@/lib/theme";
import { safeLocal, safeSession } from "@/lib/safe-storage";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-data text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">الصفحة غير موجودة</h2>
        <p className="mt-2 text-sm text-muted-foreground">الصفحة التي تبحث عنها غير موجودة أو تم نقلها.</p>
        <div className="mt-6">
          <Link to="/" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            العودة للرئيسية
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-foreground">تعذر تحميل الصفحة</h1>
        <p className="mt-2 text-sm text-muted-foreground">حدث خطأ غير متوقع. حاول مرة أخرى أو ارجع للرئيسية.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            حاول مرة أخرى
          </button>
          <a href="/" className="inline-flex items-center justify-center rounded-md border border-input px-4 py-2 text-sm font-medium text-foreground hover:bg-accent">
            الرئيسية
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      // viewport-fit=cover turns on env(safe-area-inset-*) so the shell can clear the notch,
      // Dynamic Island and home indicator; the apple-* tags make "Add to Home Screen" a real app.
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      // Dark until the boot script below repaints it for the chosen theme (theme.ts).
      { name: "theme-color", content: THEME_COLOR.dark },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "HADI" },
      { name: "format-detection", content: "telephone=no" },
      { title: "نظام هادي للتداول" },
      { name: "description", content: "نظام هادي الشخصي لإدارة التداول والانضباط والمخاطر." },
      { name: "author", content: "Hadi Alajmi" },
      { property: "og:title", content: "نظام هادي للتداول" },
      { property: "og:description", content: "نظام هادي الشخصي لإدارة التداول والانضباط والمخاطر." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    scripts: [{ children: THEME_BOOT_SCRIPT }],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

const CHUNK_RELOAD_KEY = "hadi-chunk-reload";

/**
 * A Lovable deploy deleted the code chunks this open app was built with, so the next screen
 * can't load: reload once to get the new ones. Never twice within a minute (that is a real
 * outage, and the error page shows), and only when the guard itself could be stored.
 */
function reloadForNewDeploy(e: Event) {
  const last = Number(safeSession.get(CHUNK_RELOAD_KEY)) || 0;
  if (Date.now() - last < 60_000) return;
  if (!safeSession.set(CHUNK_RELOAD_KEY, String(Date.now()))) return;
  e.preventDefault();
  window.location.reload();
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  useEffect(() => {
    window.addEventListener("vite:preloadError", reloadForNewDeploy);
    return () => window.removeEventListener("vite:preloadError", reloadForNewDeploy);
  }, []);
  useEffect(() => {
    // "Remember me" off: end the session when a new browser session starts.
    if (safeLocal.get("hadi-ephemeral") === "1" && !safeSession.get("hadi-session-only")) {
      safeLocal.remove("hadi-ephemeral");
      void supabase.auth.signOut();
    }
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") router.invalidate();
    });
    return () => data.subscription.unsubscribe();
  }, [router]);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster position="top-center" richColors />
      <InstallApp />
    </QueryClientProvider>
  );
}
