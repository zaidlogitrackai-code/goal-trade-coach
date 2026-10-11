import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Md } from "@/components/md";
import { morningGreeting } from "@/lib/ai.functions";
import { fmtDate } from "@/lib/queries";

/** Bell with the AI coach's daily morning message (created once per day on first visit). */
export function NotificationsBell() {
  const qc = useQueryClient();
  const greet = useServerFn(morningGreeting);
  const asked = useRef(false);
  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const { data, error } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(20);
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

  return (
    <Popover onOpenChange={markRead}>
      <PopoverTrigger aria-label="الإشعارات" className="relative text-muted-foreground hover:text-foreground">
        <Bell className="size-5" />
        {unread > 0 && <span className="absolute -top-1 -left-1 grid size-4 place-items-center rounded-full bg-destructive text-[10px] text-destructive-foreground">{unread}</span>}
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[70vh] w-80 overflow-y-auto p-0" dir="rtl">
        {list.length === 0 ? <p className="p-4 text-sm text-muted-foreground">لا توجد إشعارات بعد.</p> : list.map((n) => (
          <div key={n.id} className="border-b border-border p-4 text-sm leading-7 last:border-0">
            <p className="font-semibold">{n.title}</p>
            <p className="mb-1 text-xs text-muted-foreground">{fmtDate(n.created_at)}</p>
            <Md>{n.body}</Md>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
