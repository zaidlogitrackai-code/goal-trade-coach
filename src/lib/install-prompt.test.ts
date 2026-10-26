import { describe, expect, it } from "vitest";
import { installPlatform, isIosSafari, shouldOfferInstall, snoozeUntil, SNOOZE_DAYS, type InstallFacts } from "./install-prompt";

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const base: InstallFacts = { standalone: false, inFrame: false, platform: "ios", canPrompt: false, snoozedUntil: null, now: 1_000 };

describe("installPlatform", () => {
  it("reads iPhone, Android and desktop", () => {
    expect(installPlatform(IPHONE_SAFARI)).toBe("ios");
    expect(installPlatform(ANDROID)).toBe("android");
    expect(installPlatform(WINDOWS)).toBe("other");
  });
  it("treats a touch Mac as an iPad, a real Mac as desktop", () => {
    expect(installPlatform(IPAD, 5)).toBe("ios");
    expect(installPlatform(IPAD, 0)).toBe("other");
  });
  it("tells Safari from Chrome on iOS", () => {
    expect(isIosSafari(IPHONE_SAFARI)).toBe(true);
    expect(isIosSafari(IPHONE_CHROME)).toBe(false);
  });
});

describe("shouldOfferInstall", () => {
  it("offers the steps on iPhone without a prompt event", () => {
    expect(shouldOfferInstall(base)).toBe(true);
  });
  it("needs a ready prompt on Android and desktop", () => {
    expect(shouldOfferInstall({ ...base, platform: "android" })).toBe(false);
    expect(shouldOfferInstall({ ...base, platform: "android", canPrompt: true })).toBe(true);
    expect(shouldOfferInstall({ ...base, platform: "other", canPrompt: true })).toBe(true);
  });
  it("never inside the installed app or Lovable's preview", () => {
    expect(shouldOfferInstall({ ...base, standalone: true })).toBe(false);
    expect(shouldOfferInstall({ ...base, inFrame: true })).toBe(false);
  });
  it("stays quiet for a week after «لاحقاً», then comes back", () => {
    const until = snoozeUntil(base.now);
    expect(until - base.now).toBe(SNOOZE_DAYS * 86_400_000);
    expect(shouldOfferInstall({ ...base, snoozedUntil: until })).toBe(false);
    expect(shouldOfferInstall({ ...base, snoozedUntil: until, now: until })).toBe(true);
    expect(shouldOfferInstall({ ...base, snoozedUntil: Number.NaN })).toBe(true);
  });
});
