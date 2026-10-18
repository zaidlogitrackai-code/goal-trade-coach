/**
 * Appearance: فاتح | داكن | تلقائي. The html `light` class is the only runtime truth (styles.css
 * reads it, Sonner watches it). The boot script in __root.tsx is generated from the same
 * constants, so the first paint, the settings page and the live iPhone follow agree.
 */
export type ThemeChoice = "light" | "dark" | "system";
export type Theme = "light" | "dark";

export const THEME_KEY = "hadi-theme";
export const LIGHT_QUERY = "(prefers-color-scheme: light)";

/** Status-bar / Safari chrome tint: the header's --background in each theme (styles.css). */
export const THEME_COLOR: Record<Theme, string> = { dark: "#0a0a0a", light: "#e0dbd7" };

/** Missing or unknown values keep the app's original default, dark. */
export function parseThemeChoice(v: unknown): ThemeChoice {
  return v === "light" || v === "system" ? v : "dark";
}

export function resolveTheme(choice: ThemeChoice, prefersLight: boolean): Theme {
  if (choice === "system") return prefersLight ? "light" : "dark";
  return choice;
}

export function themeColor(theme: Theme): string {
  return THEME_COLOR[theme];
}

function prefersLight(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.(LIGHT_QUERY).matches;
}

export function readThemeChoice(): ThemeChoice {
  try {
    return parseThemeChoice(localStorage.getItem(THEME_KEY));
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("light", theme === "light");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
}

/** Saves the choice and repaints now; the boot script's listener keeps "system" live afterwards. */
export function setThemeChoice(choice: ThemeChoice): Theme {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* private mode: still apply for this visit */
  }
  const theme = resolveTheme(choice, prefersLight());
  applyTheme(theme);
  return theme;
}

export function currentTheme(): Theme {
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

/** Fires whenever the html class changes, whoever changed it (boot listener or settings). */
export function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/**
 * Runs in <head> before first paint (no flash), then follows the iPhone's appearance while the
 * choice is "system". It re-reads the stored choice on every change, so switching in settings
 * needs no re-subscribe. Plain ES5: it runs before any bundle loads.
 */
export const THEME_BOOT_SCRIPT = `(function(){var k=${JSON.stringify(THEME_KEY)},q=${JSON.stringify(LIGHT_QUERY)},c=${JSON.stringify(THEME_COLOR)};function a(){var v=null;try{v=localStorage.getItem(k)}catch(e){}var m=window.matchMedia&&window.matchMedia(q);var t=v==="light"||(v==="system"&&m&&m.matches)?"light":"dark";document.documentElement.classList.toggle("light",t==="light");var el=document.querySelector('meta[name="theme-color"]');if(el)el.setAttribute("content",c[t])}a();try{var m=window.matchMedia(q);if(m.addEventListener)m.addEventListener("change",a);else m.addListener(a)}catch(e){}})()`;
