import { useEffect } from "react";
import { keyboardOpen } from "@/lib/chat-ui";

/**
 * Publishes what the iPhone really shows: `--vvh` is the visible height (it shrinks when the
 * keyboard opens, 100dvh does not) and `html[data-kb]` is set while the keyboard is up, which
 * hides the tab bar. Chat frames and sheets size from --vvh so the composer stays above the
 * keyboard. Mounted once, in AppShell.
 */
export function useVisualViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let frame = 0;
    let lastHeight = -1;
    let lastKb: boolean | null = null;

    const apply = () => {
      frame = 0;
      const scale = vv.scale > 0 ? vv.scale : 1;
      // Pinch-zoom shrinks the visual viewport too; undo it so zooming never resizes the frame.
      const height = Math.round(vv.height * scale);
      if (height !== lastHeight) {
        root.style.setProperty("--vvh", `${height}px`);
        lastHeight = height;
      }
      const kb = keyboardOpen(Math.max(window.innerHeight, root.clientHeight), vv.height, scale);
      if (kb !== lastKb) {
        if (kb) root.setAttribute("data-kb", "");
        else root.removeAttribute("data-kb");
        lastKb = kb;
      }
      // iOS pans a locked chat page up when the keyboard opens even though the frame already
      // fits above it, pushing the header off screen; put it back (never while zoomed in).
      if (root.hasAttribute("data-chat") && scale <= 1.01 && (window.scrollY > 0 || vv.offsetTop > 0)) {
        window.scrollTo(0, 0);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    apply();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      root.style.removeProperty("--vvh");
      root.removeAttribute("data-kb");
    };
  }, []);
}

/**
 * While a chat is on screen the page itself never scrolls (html[data-chat]): only the message
 * list does, so a drag on the composer can't rubber-band the whole app off the keyboard.
 */
export function useChatScrollLock() {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-chat", "");
    window.scrollTo(0, 0);
    return () => root.removeAttribute("data-chat");
  }, []);
}
