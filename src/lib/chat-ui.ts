/**
 * Chat screen rules, pure so the iPhone behaviour is unit-tested: when the list follows new
 * messages, what Return does, when the on-screen keyboard counts as open, and which paste
 * carries an image.
 */

/** How close to the bottom (px) still counts as "reading the latest message". */
export const PIN_SLACK = 80;

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * Follow new rows only while he is at (or near) the bottom: scrolling up to reread an
 * analysis must not be yanked away by the next reply or a growing image.
 */
export function shouldAutoScroll(m: ScrollMetrics, slack = PIN_SLACK): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight <= slack;
}

/** Rows arrived while he was scrolled up: show the «جديد ↓» pill instead of jumping. */
export function hasNewBelow(prevCount: number, nextCount: number, pinned: boolean): boolean {
  return !pinned && prevCount > 0 && nextCount > prevCount;
}

export interface EnterKey {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  /** True while an IME / dictation is still composing the word. */
  isComposing?: boolean;
  /** 229 = the key went to an IME (Safari reports this instead of isComposing). */
  keyCode?: number;
}

/**
 * Does this keydown send the message? On a touch keyboard Return is a newline (the send
 * button sends), so long Arabic messages can have lines; a hardware keyboard sends on Enter,
 * Shift+Enter is a newline, and Cmd/Ctrl+Enter sends everywhere (iPad keyboards report a
 * coarse pointer). Never while a word is still being composed.
 */
export function enterSends(e: EnterKey, coarse: boolean): boolean {
  if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return false;
  if (e.metaKey || e.ctrlKey) return true;
  return !coarse && !e.shiftKey;
}

/** Smaller gaps are the URL bar sliding, never a keyboard (the iPhone's is ~260pt+). */
export const KEYBOARD_MIN_PX = 150;

/**
 * Is the on-screen keyboard up? The layout viewport keeps its height on iOS while the visual
 * viewport shrinks by the keyboard; pinch-zoom also shrinks it, so the zoom scale is undone first.
 */
export function keyboardOpen(layoutHeight: number, viewportHeight: number, scale = 1): boolean {
  if (!(layoutHeight > 0) || !(viewportHeight > 0)) return false;
  return layoutHeight - viewportHeight * (scale > 0 ? scale : 1) > KEYBOARD_MIN_PX;
}

interface ClipboardLike {
  files?: ArrayLike<File> | null;
  items?: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }> | null;
}

/** The image in a paste (a copied screenshot or chart), or null for plain text. */
export function pastedImage(data: ClipboardLike | null | undefined): File | null {
  if (!data) return null;
  for (const f of Array.from(data.files ?? [])) if (f.type.startsWith("image/")) return f;
  for (const i of Array.from(data.items ?? [])) {
    if (i.kind === "file" && i.type.startsWith("image/")) {
      const f = i.getAsFile();
      if (f) return f;
    }
  }
  return null;
}
