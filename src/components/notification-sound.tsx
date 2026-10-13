import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import soundAsset from "@/assets/notification.m4a.asset.json";

export const SOUND_KEY = "hadi-notification-sound";
export const soundEnabled = () => typeof window !== "undefined" && window.localStorage.getItem(SOUND_KEY) !== "off";

type Row = { id: string; read?: boolean | null; dismissed?: boolean | null };

/** Plays the notification tone once for every new unread notification. Mounted once in the app shell. */
export function NotificationSound() {
  const qc = useQueryClient();
  const audio = useRef<HTMLAudioElement | null>(null);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    const a = new Audio(soundAsset.url);
    a.preload = "auto";
    audio.current = a;

    // Browsers only allow sound after the first touch/click, so unlock it silently then.
    const unlock = () => {
      a.muted = true;
      a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

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
      if (fresh && soundEnabled()) { a.currentTime = 0; a.play().catch(() => {}); }
    };
    check();
    const unsub = qc.getQueryCache().subscribe((e) => {
      if (e.type === "updated" && e.query.queryKey[0] === "notifications") check();
    });
    // Pick up notifications written by the server (morning / evening messages).
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") qc.invalidateQueries({ queryKey: ["notifications"] });
    }, 60_000);

    return () => {
      unsub();
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [qc]);

  return null;
}
