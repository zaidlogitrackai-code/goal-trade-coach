import { supabase } from "@/integrations/supabase/client";
import { retryDecision, type RetryDecision } from "./chat-retry";

/** Where a sent message stands in its thread (used after a dropped connection). */
export async function threadState(threadId: string, message: string): Promise<RetryDecision> {
  const { data, error } = await supabase.from("coach_messages").select("role,content").eq("thread_id", threadId).order("created_at", { ascending: false }).limit(2);
  if (error) throw error;
  return retryDecision(data ?? [], message);
}
