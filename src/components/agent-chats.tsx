import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { History, MessageSquare, SquarePen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DeleteThreadButton } from "@/components/delete-thread-button";
import { isPendingDelete } from "@/lib/undo-delete";
import { currentUserId, fmtDate } from "@/lib/queries";

/**
 * ChatGPT-style conversations for an agent page: every visit opens a fresh chat,
 * and older chats live in the history sheet. Chats are `coach_threads` titled `<base> · <timestamp>`;
 * the old single thread titled exactly `<base>` is kept and shown as an old chat.
 */
export function useAgentChats(base: string, greeting: string): { c: string | null; controls: ReactNode } {
  const qc = useQueryClient();
  const [c, setC] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const lock = useRef(false);
  const booted = useRef(false);
  const key = ["agent-chats", base];

  const startNew = useCallback(async (): Promise<void> => {
    if (lock.current) return;
    lock.current = true;
    setCreating(true);
    try {
      const user_id = await currentUserId();
      const { data, error } = await supabase.from("coach_threads").insert({ user_id, title: `${base} · ${new Date().toISOString()}` }).select("id").single();
      if (error) throw error;
      await supabase.from("coach_messages").insert({ user_id, thread_id: data.id, role: "assistant", content: greeting });
      await qc.invalidateQueries({ queryKey: ["agent-chats", base] });
      setC(data.id);
    } catch { toast.error("ما قدرت أبدأ محادثة جديدة"); }
    finally { lock.current = false; setCreating(false); }
  }, [base, greeting, qc]);

  // Opening the page = a fresh chat. Reuse the newest one only if you haven't written in it yet.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      const { data: last } = await supabase.from("coach_threads").select("id").like("title", `${base} · %`).order("created_at", { ascending: false }).limit(1);
      const lastId = last?.[0]?.id;
      if (lastId) {
        const { count } = await supabase.from("coach_messages").select("id", { count: "exact", head: true }).eq("thread_id", lastId).eq("role", "user");
        if (!count) { setC(lastId); return; }
      }
      await startNew();
    })();
  }, [base, startNew]);

  const list = useQuery({
    queryKey: key,
    enabled: open,
    queryFn: async () => {
      const { data: threads, error } = await supabase
        .from("coach_threads").select("id,title,updated_at")
        .or(`title.eq.${base},title.like.${base} · %`)
        .order("updated_at", { ascending: false }).limit(50);
      if (error) throw error;
      const ids = threads.map((t) => t.id);
      const first = new Map<string, string>();
      if (ids.length) {
        const { data: msgs } = await supabase.from("coach_messages").select("thread_id,content").in("thread_id", ids).eq("role", "user").order("created_at").limit(400);
        for (const m of msgs ?? []) if (!first.has(m.thread_id)) first.set(m.thread_id, m.content.replace(/\n📎.*$/s, "").trim());
      }
      return threads.filter((t) => !isPendingDelete(t.id)).map((t) => ({ ...t, preview: first.get(t.id) || "" }));
    },
  });

  const items = list.data ?? [];
  const controls = (
    <div className="flex items-center gap-2">
      <Button size="icon" variant="secondary" className="size-9 rounded-full" aria-label="محادثة جديدة" disabled={creating} onClick={() => void startNew()}><SquarePen className="size-4" /></Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button size="icon" variant="secondary" className="size-9 rounded-full" aria-label="سجل المحادثات"><History className="size-4" /></Button>
        </SheetTrigger>
        <SheetContent side="right" className="w-[92%] overflow-y-auto sm:max-w-md">
          <SheetHeader><SheetTitle>سجل المحادثات</SheetTitle></SheetHeader>
          <Button className="mt-4 w-full gap-2" disabled={creating} onClick={() => { setOpen(false); void startNew(); }}><SquarePen className="size-4" /> محادثة جديدة</Button>
          <div className="mt-4">
            {items.length === 0 ? <EmptyState text="محادثاتك السابقة بتظهر هنا." /> : (
              <ul className="space-y-1">
                {items.map((t) => (
                  <li key={t.id} className={`group flex items-center gap-1 rounded-xl ${t.id === c ? "bg-accent" : "hover:bg-accent/60"}`}>
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-start" onClick={() => { setC(t.id); setOpen(false); }}>
                      <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{t.preview || (t.title === base ? "المحادثة القديمة" : "محادثة جديدة")}</span>
                        <span className="block text-xs text-muted-foreground">{fmtDate(t.updated_at)}</span>
                      </span>
                    </button>
                    <DeleteThreadButton id={t.id} queryKey={key} {...(t.id === c ? { onRemoved: () => void startNew() } : {})} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );

  return { c, controls };
}
