import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { deleteWithUndo } from "@/lib/undo-delete";

/**
 * Trash button for a conversation in a history list: asks first, hides the row, and only
 * deletes once the «تراجع» toast has gone (coach_messages cascade with their thread).
 * `onRemoved` runs as soon as the row disappears, e.g. to open a fresh chat in its place.
 */
export function DeleteThreadButton({ id, queryKey, onRemoved, className = "" }: {
  id: string;
  /** The history list's query: its rows are `{ id }` objects. */
  queryKey: QueryKey;
  onRemoved?: () => void;
  className?: string;
}) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey });

  function remove() {
    qc.setQueryData<{ id: string }[]>(queryKey, (old) => old?.filter((t) => t.id !== id));
    onRemoved?.();
    deleteWithUndo({
      key: id,
      message: "انحذفت المحادثة",
      commit: async () => {
        const { error } = await supabase.from("coach_threads").delete().eq("id", id);
        if (error) throw error;
        await refresh();
      },
      onUndo: () => void refresh(),
      onError: () => { toast.error("ما قدرت أحذف المحادثة"); void refresh(); },
    });
  }

  return (
    <ConfirmDialog
      trigger={
        <Button size="icon" variant="ghost" className={`shrink-0 text-muted-foreground ${className}`} aria-label="حذف المحادثة">
          <Trash2 className="size-4" />
        </Button>
      }
      title="تحذف المحادثة؟"
      description="بتنحذف المحادثة بكل رسائلها. بعد الحذف عندك ثواني تتراجع فيها."
      confirmLabel="احذف"
      destructive
      onConfirm={remove}
    />
  );
}
