import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Volume2 } from "lucide-react";
import soundAsset from "@/assets/notification.m4a.asset.json";
import { safeLocal } from "@/lib/safe-storage";

export const SOUND_KEY = "hadi-notification-sound";
export const soundEnabled = () => safeLocal.get(SOUND_KEY) !== "off";

type Row = { id: string; read?: boolean | null; dismissed?: boolean | null };

/** iOS only counts these as a tap that may start sound (pointerdown and touchstart are not). */
const GESTURES = ["touchend", "click", "keydown"] as const;
const CHIP = "data-sound-chip";

/**
 * Plays the notification tone once for every new unread notification (the heartbeat re-reads
 * the bell each minute). Mounted once in the app shell. If the iPhone still refuses to play,
 * a chip asks for the one tap that unlocks it.
 */
export function NotificationSound() {
  const qc = useQueryClient();
  const audio = useRef<HTMLAudioElement | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const [blocked, setBlocked] = useState(false);
  // Called once any play is heard: the element is unlocked, the tap listeners can go.
  const played = useRef<() => void>(() => {});

  useEffect(() => {
    // Safari 16.4+: a short alert that ducks his music instead of stopping it.
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) {
      try { session.type = "transient"; } catch { /* read-only on some versions */ }
    }
    const a = new Audio(soundAsset.url);
    a.preload = "auto";
    audio.current = a;

    // A silent play inside a real tap unlocks this element for later. The listeners stay until
    // a play actually succeeds: a rejected first try (still loading, Low Power) gets another tap.
    let unlocked = false;
    let trying = false;
    const detach = () => GESTURES.forEach((ev) => window.removeEventListener(ev, unlock, true));
    played.current = () => {
      unlocked = true;
      setBlocked(false);
      detach();
    };
    function unlock(e: Event) {
      // A tone already playing means it is unlocked; a silent play now would cut it off.
      if (unlocked || trying || !a.paused) return;
      // The chip plays the tone out loud itself; a silent play here would cut it off.
      if (e.target instanceof Element && e.target.closest(`[${CHIP}]`)) return;
      trying = true;
      a.muted = true;
      a.play()
        .then(() => {
          a.pause();
          a.currentTime = 0;
          played.current();
        })
        .catch(() => {})
        .finally(() => {
          a.muted = false;
          trying = false;
        });
    }
    GESTURES.forEach((ev) => window.addEventListener(ev, unlock, { capture: true, passive: true }));

    const check = () => {
      const rows = qc.getQueryData<Row[]>(["notifications"]);
      if (!rows) return;
      if (!seen.current) { seen.current = new Set(rows.map((r) => r.id)); return; } // first load: stay silent
      let fresh = false;
      for (const r of rows) {
        if (seen.current.has(r.id)) continue;
        seen.current.add(r.id);
        if (!r.read && !r.dismissed) fresh = true;
      }
      if (fresh && soundEnabled()) {
        a.currentTime = 0;
        a.play()
          .then(() => played.current())
          .catch((err: unknown) => {
            // Not yet allowed to play: ask for the tap. Other failures (interrupted) stay quiet.
            if (err instanceof DOMException && err.name === "NotAllowedError") setBlocked(true);
          });
      }
    };
    check();
    const unsub = qc.getQueryCache().subscribe((e) => {
      if (e.type === "updated" && e.query.queryKey[0] === "notifications") check();
    });

    return () => {
      unsub();
      detach();
      a.pause();
    };
  }, [qc]);

  if (!blocked) return null;

  function enable() {
    const a = audio.current;
    if (!a) return;
    a.muted = false;
    a.currentTime = 0;
    // Inside this tap the play is allowed, and he hears the alert he just missed.
    a.play().then(() => played.current()).catch(() => {});
  }

  return (
    <button
      type="button"
      {...{ [CHIP]: "" }}
      onClick={enable}
      className="glass-strong fixed inset-x-0 top-[calc(env(safe-area-inset-top)+4.5rem)] z-50 mx-auto flex min-h-11 w-fit items-center gap-2 rounded-full px-4 text-sm font-medium active:scale-95 lg:top-4"
    >
      <Volume2 className="size-4" aria-hidden="true" />
      اضغط لتفعيل الصوت
    </button>
  );
}
