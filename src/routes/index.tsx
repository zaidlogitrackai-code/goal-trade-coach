import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "نظام هادي للتداول — الرئيسية" },
      { name: "description", content: "نظام تداول شخصي عربي لإدارة المخاطر والانضباط والأهداف اليومية." },
      { property: "og:title", content: "نظام هادي للتداول" },
      { property: "og:description", content: "نظام تداول شخصي عربي لإدارة المخاطر والانضباط والأهداف اليومية." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    throw redirect({ to: data.session ? "/dashboard" : "/auth" });
  },
});
