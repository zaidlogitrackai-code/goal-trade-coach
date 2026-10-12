import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Md } from "@/components/md";
import { morningGreeting } from "@/lib/ai.functions";
import { fmtDate } from "@/lib/queries";

/** Start of today on this device (older notifications are cleared automatically, so the bell never piles up). */
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Bell with the AI coach's daily morning message (created once per day on first visit). */
export function NotificationsBell() {
  const qc = useQueryClient();
  const greet = useServerFn(morningGreeting);
  const asked = useRef(false);
  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const since = startOfToday();
      // Daily clean-up: anything from before today disappears on its own.
      await supabase.from("notifications").delete().lt("created_at", since);
      const { data, error } = await supabase.from("notifications").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      return data;
    },
  });
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    greet().then((r) => { if (r?.created) qc.invalidateQueries({ queryKey: ["notifications"] }); }).catch(() => {});
  }, [greet, qc]);
  const list = q.data ?? [];
  const unread = list.filter((n) => !n.read).length;

  async function markRead(open: boolean) {
    if (!open || unread === 0) return;
    await supabase.from("notifications").update({ read: true }).eq("read", false);
    qc.invalidateQueries({ queryKey: ["notifications"] });
  }

  async function removeOne(id: string) {
    await supabase.from("notifications").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["notifications"] });
  }

  async function removeAll() {
    if (!list.length) return;
    await supabase.from("notifications").delete().in("id", list.map((n) => n.id));
    qc.invalidateQueries({ queryKey: ["notifications"] });
  }

  return (
    <Popover onOpenChange={markRead}>
      <PopoverTrigger aria-label="الإشعارات" className="relative text-muted-foreground hover:text-foreground">
        <Bell className="size-5" />
        {unread > 0 && <span className="absolute -top-1 -left-1 grid size-4 place-items-center rounded-full bg-destructive text-[10px] text-destructive-foreground">{unread}</span>}
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[70vh] w-80 overflow-y-auto p-0" dir="rtl">
        {list.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">ما في إشعارات اليوم. الإشعارات تختفي لحالها كل يوم.</p>
        ) : (
          <>
            <button onClick={removeAll} className="flex w-full items-center justify-center gap-1.5 border-b border-border p-2 text-xs text-muted-foreground hover:bg-accent hover:text-destructive">
              <Trash2 className="size-3.5" /> امسح كل الإشعارات
            </button>
            {list.map((n) => (
              <div key={n.id} className="relative border-b border-border p-4 pr-8 text-sm leading-7 last:border-0">
                <p className="font-semibold">{n.title}</p>
                <p className="mb-1 text-xs text-muted-foreground">{fmtDate(n.created_at)}</p>
                <div className="line-clamp-3"><Md>{n.body}</Md></div>
                <button aria-label="حذف الإشعار" onClick={() => removeOne(n.id)} className="absolute left-2 top-3 rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-destructive">
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
