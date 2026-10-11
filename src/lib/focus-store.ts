import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { currentUserId } from "@/lib/queries";
import {
  FOCUS_CATEGORY,
  FOCUS_TITLE,
  mergeFocus,
  parseFocus,
  type FocusPatch,
  type FocusProfile,
} from "@/lib/focus";

/** Client-side read/write of the focus profile (one hidden knowledge_notes row). */
async function readRow() {
  const { data, error } = await supabase
    .from("knowledge_notes")
    .select("id,content")
    .eq("category", FOCUS_CATEGORY)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

export const readFocus = async (): Promise<FocusProfile> => parseFocus((await readRow())?.content);

export const focusQuery = queryOptions({ queryKey: ["focus"], queryFn: readFocus });

export async function saveFocus(patch: FocusPatch): Promise<FocusProfile> {
  const row = await readRow();
  const next = mergeFocus(parseFocus(row?.content), patch);
  const content = JSON.stringify(next);
  const { error } = row
    ? await supabase.from("knowledge_notes").update({ content }).eq("id", row.id)
    : await supabase
        .from("knowledge_notes")
        .insert({
          user_id: await currentUserId(),
          title: FOCUS_TITLE,
          category: FOCUS_CATEGORY,
          content,
        });
  if (error) throw new Error(error.message);
  return next;
}
