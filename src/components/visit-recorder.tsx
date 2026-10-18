import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { currentUserId, settingsQuery } from "@/lib/queries";
import { dayKey, safeTz } from "@/lib/trading-day";

/** Silently marks today as a visit day (feeds the hidden login streak). */
export function VisitRecorder() {
  const s = useQuery(settingsQuery);
  const qc = useQueryClient();
  const tz = safeTz(s.data?.timezone);
  useEffect(() => {
    if (s.isLoading) return;
    const day = dayKey(new Date(), tz);
    if (localStorage.getItem("visit-day") === day) return;
    void (async () => {
      const user_id = await currentUserId();
      const { error } = await supabase.from("user_visits").upsert({ user_id, day }, { onConflict: "user_id,day", ignoreDuplicates: true });
      if (!error) { localStorage.setItem("visit-day", day); qc.invalidateQueries({ queryKey: ["visits"] }); }
    })();
  }, [s.isLoading, tz, qc]);
  return null;
}
