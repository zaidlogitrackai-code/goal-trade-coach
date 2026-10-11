import { createFileRoute, Navigate, Outlet, redirect, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, Loading } from "@/components/app-shell";
import { settingsQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/auth" });
    return { userId: data.session.user.id };
  },
  component: Layout,
});

function Layout() {
  const { pathname } = useLocation();
  const { data: settings, isLoading } = useQuery(settingsQuery);
  if (isLoading) return <Loading />;
  const onboarding = pathname.startsWith("/onboarding");
  if (!settings?.onboarded && !onboarding) return <Navigate to="/onboarding" />;
  if (onboarding) return <Outlet />;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
