import { useEffect, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { Share, SquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { safeLocal } from "@/lib/safe-storage";
import {
  INSTALL_SNOOZE_KEY, installPlatform, isIosSafari, shouldOfferInstall, snoozeUntil,
} from "@/lib/install-prompt";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Caught at module load: Chrome can fire it before this component mounts, and fires it once.
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    safeLocal.set(INSTALL_SNOOZE_KEY, String(Number.MAX_SAFE_INTEGER));
    listeners.forEach((l) => l());
  });
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function inFrame() {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

/**
 * «ثبّت هادي على جوالك»: a small card above the tab bar. Android gets the browser's own
 * install prompt; iPhone gets the Share → «إضافة إلى الشاشة الرئيسية» steps in a sheet.
 * Hidden in the installed app, in Lovable's preview, on chats and while typing.
 */
export function InstallApp() {
  const { pathname } = useLocation();
  const [show, setShow] = useState(false);
  const [steps, setSteps] = useState(false);
  const [ios, setIos] = useState(false);
  const [safari, setSafari] = useState(true);

  useEffect(() => {
    const ua = navigator.userAgent;
    const platform = installPlatform(ua, navigator.maxTouchPoints);
    setIos(platform === "ios");
    setSafari(isIosSafari(ua));
    const update = () => setShow(shouldOfferInstall({
      standalone: isStandalone(),
      inFrame: inFrame(),
      platform,
      canPrompt: deferred !== null,
      snoozedUntil: Number(safeLocal.get(INSTALL_SNOOZE_KEY) ?? NaN),
      now: Date.now(),
    }));
    update();
    listeners.add(update);
    return () => { listeners.delete(update); };
  }, []);

  function later() {
    safeLocal.set(INSTALL_SNOOZE_KEY, String(snoozeUntil(Date.now())));
    setSteps(false);
    setShow(false);
  }

  async function install() {
    if (!deferred) { setSteps(true); return; }
    const e = deferred;
    await e.prompt();
    const { outcome } = await e.userChoice;
    deferred = null;
    if (outcome === "accepted") setShow(false);
    else later();
  }

  if (!show) return null;
  // Signed-in pages have the floating tab bar under lg: sit above it, else at the bottom edge.
  const aboveTabs = pathname !== "/auth" && pathname !== "/";

  return (
    <>
      <div
        role="dialog"
        aria-label="تثبيت التطبيق"
        className={`glass-strong fixed inset-x-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-3xl p-3 shadow-lg [html[data-chat]_&]:hidden [html[data-kb]_&]:hidden ${
          aboveTabs ? "bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+5rem)] lg:bottom-6" : "bottom-[max(0.75rem,env(safe-area-inset-bottom))]"
        }`}
      >
        <img src="/icon-192.png" alt="" className="size-11 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">ثبّت هادي على جوالك</p>
          <p className="truncate text-xs text-muted-foreground">يفتح كتطبيق من الشاشة الرئيسية</p>
        </div>
        <Button variant="ghost" className="h-11 shrink-0 px-3 text-muted-foreground" onClick={later}>لاحقاً</Button>
        <Button className="h-11 shrink-0 px-4" onClick={() => void install()}>ثبّت</Button>
      </div>

      <ResponsiveSheet open={steps} onOpenChange={setSteps} title="أضف هادي للشاشة الرئيسية">
        {ios && !safari && (
          <p className="mb-4 rounded-2xl bg-secondary/60 p-3 text-sm">افتح الرابط بسفاري أولاً، وبعدها اتبع الخطوات.</p>
        )}
        <ol className="space-y-3 text-sm">
          <li className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary font-semibold">١</span>
            <span className="flex-1">اضغط زر المشاركة</span>
            <Share className="size-5 text-primary" />
          </li>
          <li className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary font-semibold">٢</span>
            <span className="flex-1">اختر «إضافة إلى الشاشة الرئيسية»</span>
            <SquarePlus className="size-5 text-primary" />
          </li>
          <li className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary font-semibold">٣</span>
            <span className="flex-1">اضغط «إضافة» — وافتح هادي من أيقونته</span>
          </li>
        </ol>
        {!ios && <p className="mt-4 text-xs text-muted-foreground">بالأندرويد: من قائمة المتصفح ⋮ اختر «تثبيت التطبيق».</p>}
        <Button variant="ghost" className="mt-5 h-11 w-full text-muted-foreground" onClick={later}>ذكّرني بعد أسبوع</Button>
      </ResponsiveSheet>
    </>
  );
}
