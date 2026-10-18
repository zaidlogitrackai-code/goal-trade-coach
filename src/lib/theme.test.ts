import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIGHT_QUERY,
  THEME_BOOT_SCRIPT,
  THEME_COLOR,
  THEME_KEY,
  currentTheme,
  parseThemeChoice,
  resolveTheme,
  setThemeChoice,
  themeColor,
} from "./theme";

type Listener = () => void;

/** A controllable prefers-color-scheme: flip `light` and fire `change` like iOS does. */
function mockScheme(light: boolean) {
  const listeners: Listener[] = [];
  const state = { light };
  const mql = () => ({
    get matches() {
      return state.light;
    },
    media: LIGHT_QUERY,
    addEventListener: (_: string, fn: Listener) => listeners.push(fn),
    removeEventListener: () => {},
    addListener: (fn: Listener) => listeners.push(fn),
    removeListener: () => {},
  });
  vi.spyOn(window, "matchMedia").mockImplementation(mql as unknown as typeof window.matchMedia);
  return {
    flip(next: boolean) {
      state.light = next;
      listeners.forEach((fn) => fn());
    },
  };
}

function metaColor() {
  return document.querySelector('meta[name="theme-color"]')?.getAttribute("content");
}

function boot() {
  new Function(THEME_BOOT_SCRIPT)();
}

beforeEach(() => {
  document.head.innerHTML = '<meta name="theme-color" content="#0a0a0a" />';
  document.documentElement.className = "";
  localStorage.clear();
});

afterEach(() => vi.restoreAllMocks());

describe("resolveTheme", () => {
  it("fixed choices ignore the phone", () => {
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("dark", true)).toBe("dark");
  });

  it("system follows prefers-color-scheme", () => {
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
  });

  it("unknown stored values fall back to dark", () => {
    expect(parseThemeChoice(null)).toBe("dark");
    expect(parseThemeChoice("blue")).toBe("dark");
    expect(parseThemeChoice("system")).toBe("system");
  });
});

describe("theme-color", () => {
  it("matches each theme's header background", () => {
    expect(themeColor("dark")).toBe("#0a0a0a");
    expect(themeColor("light")).toBe("#e0dbd7");
  });
});

describe("setThemeChoice", () => {
  it("system resolves from the matchMedia mock and tints the status bar", () => {
    mockScheme(true);
    expect(setThemeChoice("system")).toBe("light");
    expect(localStorage.getItem(THEME_KEY)).toBe("system");
    expect(currentTheme()).toBe("light");
    expect(metaColor()).toBe(THEME_COLOR.light);
  });

  it("dark removes the light class", () => {
    document.documentElement.classList.add("light");
    mockScheme(true);
    expect(setThemeChoice("dark")).toBe("dark");
    expect(currentTheme()).toBe("dark");
    expect(metaColor()).toBe(THEME_COLOR.dark);
  });
});

describe("boot script", () => {
  it("agrees with resolveTheme for every stored choice and phone setting", () => {
    for (const stored of [null, "light", "dark", "system"]) {
      for (const light of [true, false]) {
        vi.restoreAllMocks();
        mockScheme(light);
        localStorage.clear();
        if (stored) localStorage.setItem(THEME_KEY, stored);
        document.documentElement.className = "";
        boot();
        const want = resolveTheme(parseThemeChoice(stored), light);
        expect(currentTheme(), `${stored}/${light}`).toBe(want);
        expect(metaColor()).toBe(THEME_COLOR[want]);
      }
    }
  });

  it("follows the iPhone live while the choice is automatic", () => {
    localStorage.setItem(THEME_KEY, "system");
    const scheme = mockScheme(false);
    boot();
    expect(currentTheme()).toBe("dark");
    scheme.flip(true);
    expect(currentTheme()).toBe("light");
    expect(metaColor()).toBe(THEME_COLOR.light);
  });

  it("ignores phone changes once a fixed theme is chosen", () => {
    localStorage.setItem(THEME_KEY, "system");
    const scheme = mockScheme(false);
    boot();
    setThemeChoice("dark");
    scheme.flip(true);
    expect(currentTheme()).toBe("dark");
  });
});
