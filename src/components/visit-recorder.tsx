import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { currentUserId, settingsQuery } from "@/lib/queries";
import { safeLocal } from "@/lib/safe-storage";
import { dayKey, safeTz } from "@/lib/trading-day";
import { useBeat } from "@/hooks/use-resume";

/** Silently marks today as a visit day (feeds the hidden login streak). */
export function VisitRecorder() {
  const s = useQuery(settingsQuery);
  const qc = useQueryClient();
  const tz = safeTz(s.data?.timezone);
  const record = useCallback(() => {
    const day = dayKey(new Date(), tz);
    if (safeLocal.get("visit-day") === day) return;
    void (async () => {
      const user_id = await currentUserId();
      const { error } = await supabase.from("user_visits").upsert({ user_id, day }, { onConflict: "user_id,day", ignoreDuplicates: true });
      if (!error) { safeLocal.set("visit-day", day); qc.invalidateQueries({ queryKey: ["visits"] }); }
    })();
  }, [tz, qc]);
  useEffect(() => {
    if (!s.isLoading) record();
  }, [s.isLoading, record]);
  // The home-screen app can stay open for days: a resume on a new day is a new visit.
  useBeat((beat) => { if (beat === "resume" && !s.isLoading) record(); });
  return null;
}
