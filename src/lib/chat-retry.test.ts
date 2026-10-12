import { describe, expect, it } from "vitest";
import { friendlyError, isNetworkError, retryText, sendWithRetry, shouldSkipUserInsert, unansweredMessage } from "./chat-retry";

describe("chat retry", () => {
  it("treats 'Failed to fetch' as a network drop", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new Error("صار خطأ"))).toBe(false);
  });

  it("never shows the English browser error", () => {
    expect(friendlyError(new TypeError("Failed to fetch"))).toContain("أعد المحاولة");
    expect(friendlyError(new Error("Internal"))).not.toContain("Internal");
  });

  it("skips re-saving the same unanswered user message on retry", () => {
    expect(shouldSkipUserInsert({ role: "user", content: "مرحبا" }, "مرحبا")).toBe(true);
    expect(shouldSkipUserInsert({ role: "assistant", content: "مرحبا" }, "مرحبا")).toBe(false);
    expect(shouldSkipUserInsert({ role: "user", content: "هلا" }, "مرحبا")).toBe(false);
    // Retried after a reload (image no longer in memory): still the same message.
    expect(shouldSkipUserInsert({ role: "user", content: "حلل\n📎 (صورة مرفقة)" }, "حلل")).toBe(true);
  });

  it("finds the last unanswered user message", () => {
    expect(unansweredMessage([{ role: "assistant", content: "a" }, { role: "user", content: "b" }])?.content).toBe("b");
    expect(unansweredMessage([{ role: "user", content: "b" }, { role: "assistant", content: "a" }])).toBeNull();
  });

  it("drops the image marker when resending", () => {
    expect(retryText("حلل\n📎 (صورة مرفقة)")).toBe("حلل");
  });

  it("resends exactly once, as a retry, after a network drop", async () => {
    const calls: boolean[] = [];
    const out = await sendWithRetry(async (retry) => { calls.push(retry); if (!retry) throw new TypeError("Failed to fetch"); return "ok"; }, 0);
    expect(out).toBe("ok");
    expect(calls).toEqual([false, true]);
  });

  it("does not resend on a normal server error", async () => {
    let n = 0;
    await expect(sendWithRetry(async () => { n++; throw new Error("رصيد"); }, 0)).rejects.toThrow();
    expect(n).toBe(1);
  });
});
