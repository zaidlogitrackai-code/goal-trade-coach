import { supabase } from "@/integrations/supabase/client";

/** Ends onboarding. 'كمّل لاحقاً' calls it too: unmet defaults then warn, never block. */
export async function finishSetup() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("سجّل دخولك أول");
  const { error } = await supabase.from("trading_settings").update({ onboarded: true }).eq("user_id", user.id);
  if (error) throw error;
}
