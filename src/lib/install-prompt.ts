/**
 * Whether to offer "install HADI" on this device. Android browsers hand us the native
 * install prompt (`beforeinstallprompt`); iPhone Safari has none, so it gets the
 * Share → «إضافة إلى الشاشة الرئيسية» steps instead. Never inside the installed app, never
 * in Lovable's preview iframe, and «لاحقاً» snoozes it for a week.
 */
export type InstallPlatform = "ios" | "android" | "other";

export const SNOOZE_DAYS = 7;
export const INSTALL_SNOOZE_KEY = "hadi-install-snooze";

/** iPadOS reports a Mac user agent, so a "Mac" with a touch screen is an iPad. */
export function installPlatform(ua: string, maxTouchPoints = 0): InstallPlatform {
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Macintosh/i.test(ua) && maxTouchPoints > 1) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

/** Only Safari can add to the Home Screen on older iOS; Chrome/Firefox on iOS say CriOS/FxiOS. */
export function isIosSafari(ua: string): boolean {
  return /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//i.test(ua);
}

export interface InstallFacts {
  /** display-mode: standalone, or iOS navigator.standalone: already opened from the icon. */
  standalone: boolean;
  /** window.top !== window: Lovable's editor preview. */
  inFrame: boolean;
  platform: InstallPlatform;
  /** The browser fired beforeinstallprompt, so a native prompt is ready. */
  canPrompt: boolean;
  /** Epoch ms from storage, or null/NaN when never snoozed. */
  snoozedUntil: number | null;
  now: number;
}

export function shouldOfferInstall(f: InstallFacts): boolean {
  if (f.standalone || f.inFrame) return false;
  if (f.snoozedUntil != null && Number.isFinite(f.snoozedUntil) && f.now < f.snoozedUntil) return false;
  // iPhone has no prompt event: the steps always apply. Elsewhere only a ready prompt counts.
  return f.platform === "ios" || f.canPrompt;
}

export function snoozeUntil(now: number): number {
  return now + SNOOZE_DAYS * 24 * 60 * 60 * 1000;
}
