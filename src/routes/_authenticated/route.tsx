import { useEffect } from "react";
import { createFileRoute, Navigate, Outlet, redirect, useLocation, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { RotateCw, WifiOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, Loading } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { settingsQuery } from "@/lib/queries";
import { useHeartbeat } from "@/hooks/use-resume";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getSession();
    // Offline with an expired token the session is still stored and only its refresh failed:
    // the layout shows the retry screen instead of sending him back to log in.
    if (!data.session && !isAuthRetryableFetchError(error)) throw redirect({ to: "/auth" });
    return { userId: data.session?.user.id ?? null };
  },
  component: Layout,
});

function Layout() {
  useHeartbeat();
  const router = useRouter();
  const { pathname } = useLocation();
  const s = useQuery(settingsQuery);
  // No answer yet is not "no settings": onboarding only when the read came back empty.
  if (s.data === undefined) {
    if (s.isError || s.isPaused || s.failureCount > 0) {
      return <OfflineScreen onRetry={() => { void router.invalidate(); void s.refetch(); }} />;
    }
    return <Loading />;
  }
  const onboarding = pathname.startsWith("/onboarding");
  if (!s.data?.onboarded && !onboarding) return <Navigate to="/onboarding" />;
  if (onboarding) return <Outlet />;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

/** Cold start without a connection (or a failing read): say so and retry, never a blank app. */
function OfflineScreen({ onRetry }: { onRetry: () => void }) {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  // Coming back online retries by itself.
  useEffect(() => {
    window.addEventListener("online", onRetry);
    return () => window.removeEventListener("online", onRetry);
  }, [onRetry]);
  return (
    <div className="safe-top flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <WifiOff className="size-10 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold">{offline ? "ما في اتصال بالإنترنت" : "ما قدرت أجيب بياناتك"}</h1>
        <p className="text-sm text-muted-foreground">{offline ? "أول ما يرجع النت بفتح لك التطبيق لحاله." : "تأكد من النت وجرّب مرة ثانية."}</p>
      </div>
      <Button size="lg" className="gap-2" onClick={onRetry}>
        <RotateCw className="size-4" aria-hidden="true" /> جرّب مرة ثانية
      </Button>
    </div>
  );
}
