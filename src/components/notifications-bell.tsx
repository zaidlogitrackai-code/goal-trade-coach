import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bell, ChevronLeft, Trash2, Volume2, VolumeX, X } from "lucide-react";
import { SOUND_KEY, soundEnabled } from "@/components/notification-sound";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { Md } from "@/components/md";
import { PHONE_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { morningGreeting } from "@/lib/ai.functions";
import { notificationTarget, type NotificationTarget } from "@/lib/notification-target";
import { fmtDate, settingsQuery } from "@/lib/queries";
import { dayStart } from "@/lib/trading-day";

// Once per page load however often the bell remounts (an iPad turning past the sidebar width).
let greeted = false;

interface Row {
  id: string;
  kind: string;
  dedupe_key: string | null;
  title: string;
  body: string;
  created_at: string;
  read: boolean;
}

/** Bell with the AI coach's daily morning message (created once per day on first visit). */
export function NotificationsBell() {
  const qc = useQueryClient();
  const greet = useServerFn(morningGreeting);
  const navigate = useNavigate();
  const phone = useMediaQuery(PHONE_QUERY);
  const [open, setOpen] = useState(false);
  const [sound, setSound] = useState(true);
  useEffect(() => { setSound(soundEnabled()); }, []);
  function toggleSound() {
    const next = !sound;
    setSound(next);
    window.localStorage.setItem(SOUND_KEY, next ? "on" : "off");
  }
  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      // Only today in the trader's zone, so the bell never piles up. Older rows are
      // filtered out, never deleted: their dedupe_keys stop alerts from firing twice.
      const st = await qc.ensureQueryData(settingsQuery).catch(() => null);
      const since = dayStart(new Date(), st?.timezone).toISOString();
      const { data, error } = await supabase.from("notifications").select("*").gte("created_at", since).eq("dismissed", false).order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      return data;
    },
  });
  useEffect(() => {
    if (greeted) return;
    greeted = true;
    greet().then((r) => { if (r?.created) qc.invalidateQueries({ queryKey: ["notifications"] }); }).catch(() => {});
  }, [greet, qc]);
  const list: Row[] = q.data ?? [];
  const unread = list.filter((n) => !n.read).length;

  async function markRead() {
    if (unread === 0) return;
    await supabase.from("notifications").update({ read: true }).eq("read", false);
    qc.invalidateQueries({ queryKey: ["notifications"] });
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) void markRead();
  }

  async function removeOne(id: string) {
    // Hide, don't delete: today's rows also stop the daily messages from being written twice.
    await supabase.from("notifications").update({ dismissed: true, read: true }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["notifications"] });
  }

  async function removeAll() {
    if (!list.length) return;
    await supabase.from("notifications").update({ dismissed: true, read: true }).in("id", list.map((n) => n.id));
    qc.invalidateQueries({ queryKey: ["notifications"] });
  }

  function go(t: NotificationTarget) {
    setOpen(false);
    if (t.to === "/trades") void navigate({ to: "/trades", search: { trade: t.search.trade } });
    else void navigate({ to: t.to });
  }

  const trigger = (
    <button
      type="button"
      aria-label={unread ? `الإشعارات، ${unread} جديدة` : "الإشعارات"}
      className="relative grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground active:bg-accent"
    >
      <Bell className="size-5" />
      {unread > 0 && (
        <span className="absolute end-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground tabular-nums">
          {unread}
        </span>
      )}
    </button>
  );

  const content = (
    <div dir="rtl">
      <button type="button" onClick={toggleSound} className="flex min-h-11 w-full items-center justify-center gap-1.5 border-b border-border px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
        {sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />} {sound ? "صوت الإشعارات: شغّال" : "صوت الإشعارات: مطفي"}
      </button>
      {list.length === 0 ? (
        <p className="p-4 text-sm leading-relaxed text-muted-foreground">ما في إشعارات اليوم. الإشعارات تختفي لحالها كل يوم.</p>
      ) : (
        <>
          <button type="button" onClick={removeAll} className="flex min-h-11 w-full items-center justify-center gap-1.5 border-b border-border px-3 text-sm text-muted-foreground hover:bg-accent hover:text-destructive">
            <Trash2 className="size-4" /> امسح كل الإشعارات
          </button>
          <ul>
            {list.map((n) => (
              <NotificationRow key={n.id} n={n} onOpen={go} onHide={() => void removeOne(n.id)} />
            ))}
          </ul>
        </>
      )}
    </div>
  );

  if (phone) {
    return (
      <ResponsiveSheet trigger={trigger} open={open} onOpenChange={onOpenChange} title="الإشعارات" className="-mx-5">
        {content}
      </ResponsiveSheet>
    );
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="max-h-[70vh] w-80 overflow-y-auto p-0">
        {content}
      </PopoverContent>
    </Popover>
  );
}

/** Tap the text to read all of it; the link under it goes where the alert is about. */
function NotificationRow({ n, onOpen, onHide }: { n: Row; onOpen: (t: NotificationTarget) => void; onHide: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const target = notificationTarget(n.kind, n.dedupe_key);
  return (
    <li className="border-b border-border last:border-0">
      <div className="flex items-start gap-1 pe-1 ps-4 pt-2">
        <div
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          onClick={() => setExpanded((x) => !x)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded((x) => !x); } }}
          className="min-w-0 flex-1 cursor-pointer py-1.5 text-sm"
        >
          <p className="font-semibold leading-normal">{n.title}</p>
          <p className="mb-1 text-xs text-muted-foreground">{fmtDate(n.created_at)}</p>
          <div className={expanded ? undefined : "line-clamp-3"}><Md>{n.body}</Md></div>
        </div>
        <button type="button" aria-label="إخفاء الإشعار" onClick={onHide} className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-destructive active:bg-accent">
          <X className="size-4" />
        </button>
      </div>
      <button type="button" onClick={() => onOpen(target)} className="ms-4 mb-1 flex min-h-11 items-center gap-1 text-sm font-medium text-primary">
        {target.label} <ChevronLeft className="size-4" aria-hidden="true" />
      </button>
    </li>
  );
}
