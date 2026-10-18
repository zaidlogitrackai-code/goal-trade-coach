import { describe, expect, it } from "vitest";
import { enterSends, hasNewBelow, keyboardOpen, pastedImage, shouldAutoScroll } from "./chat-ui";

describe("shouldAutoScroll", () => {
  it("follows when he is at the bottom or within the slack", () => {
    expect(shouldAutoScroll({ scrollTop: 1400, scrollHeight: 2000, clientHeight: 600 })).toBe(true);
    expect(shouldAutoScroll({ scrollTop: 1330, scrollHeight: 2000, clientHeight: 600 })).toBe(true);
  });
  it("stays put while he reads further up", () => {
    expect(shouldAutoScroll({ scrollTop: 900, scrollHeight: 2000, clientHeight: 600 })).toBe(false);
  });
  it("a list shorter than the screen is always at the bottom", () => {
    expect(shouldAutoScroll({ scrollTop: 0, scrollHeight: 300, clientHeight: 600 })).toBe(true);
  });
});

describe("hasNewBelow", () => {
  it("only when rows arrive while scrolled up", () => {
    expect(hasNewBelow(5, 6, false)).toBe(true);
    expect(hasNewBelow(5, 6, true)).toBe(false);
    expect(hasNewBelow(5, 5, false)).toBe(false);
  });
  it("not for the first load of a thread", () => {
    expect(hasNewBelow(0, 12, false)).toBe(false);
  });
});

describe("enterSends", () => {
  it("a hardware keyboard sends on Enter, Shift+Enter is a newline", () => {
    expect(enterSends({ key: "Enter" }, false)).toBe(true);
    expect(enterSends({ key: "Enter", shiftKey: true }, false)).toBe(false);
  });
  it("on the iPhone keyboard Return is a newline", () => {
    expect(enterSends({ key: "Enter" }, true)).toBe(false);
  });
  it("Cmd/Ctrl+Enter sends even on a touch device (iPad keyboard)", () => {
    expect(enterSends({ key: "Enter", metaKey: true }, true)).toBe(true);
    expect(enterSends({ key: "Enter", ctrlKey: true }, false)).toBe(true);
  });
  it("never while a word is still being composed", () => {
    expect(enterSends({ key: "Enter", isComposing: true }, false)).toBe(false);
    expect(enterSends({ key: "Enter", keyCode: 229 }, false)).toBe(false);
    expect(enterSends({ key: "Enter", metaKey: true, isComposing: true }, true)).toBe(false);
  });
  it("other keys never send", () => {
    expect(enterSends({ key: "a" }, false)).toBe(false);
  });
});

describe("keyboardOpen", () => {
  it("an iPhone keyboard shrinks the visual viewport by far more than the threshold", () => {
    expect(keyboardOpen(844, 508)).toBe(true);
  });
  it("the URL bar sliding in and out is not a keyboard", () => {
    expect(keyboardOpen(844, 770)).toBe(false);
    expect(keyboardOpen(770, 844)).toBe(false);
  });
  it("pinch-zoom is not a keyboard", () => {
    expect(keyboardOpen(844, 422, 2)).toBe(false);
    expect(keyboardOpen(844, 254, 2)).toBe(true);
  });
  it("missing sizes are not a keyboard", () => {
    expect(keyboardOpen(0, 0)).toBe(false);
    expect(keyboardOpen(844, Number.NaN)).toBe(false);
  });
});

describe("pastedImage", () => {
  const png = new File(["x"], "shot.png", { type: "image/png" });
  it("takes the pasted screenshot", () => {
    expect(pastedImage({ files: [png] })).toBe(png);
    expect(pastedImage({ files: [], items: [{ kind: "file", type: "image/png", getAsFile: () => png }] })).toBe(png);
  });
  it("ignores pasted text and other files", () => {
    const pdf = new File(["x"], "a.pdf", { type: "application/pdf" });
    expect(pastedImage({ files: [pdf], items: [{ kind: "string", type: "text/plain", getAsFile: () => null }] })).toBeNull();
    expect(pastedImage(null)).toBeNull();
  });
});
