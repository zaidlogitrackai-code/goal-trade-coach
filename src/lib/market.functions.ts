import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { quotes } from "./market.server";

export const getQuotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => quotes());
