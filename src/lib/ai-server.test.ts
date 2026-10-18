import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiError, callAI, resetAiUsage } from "./ai.server";

// One streamed Responses API reply: text deltas, then completed or incomplete.
function stream(text: string, end: "completed" | "incomplete") {
  const events = [
    { type: "response.output_text.delta", delta: text },
    { type: `response.${end}`, response: { status: end, usage: { input_tokens: 10, output_tokens: 5 } } },
  ];
  return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n`).join("") + "data: [DONE]\n", { status: 200 });
}

describe("callAI", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    resetAiUsage();
    vi.stubEnv("LOVABLE_API_KEY", "test");
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => { fetchMock.mockReset(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("retries once when the reply is incomplete", async () => {
    fetchMock.mockResolvedValueOnce(stream('{"reply":"نص', "incomplete")).mockResolvedValueOnce(stream('{"reply":"كامل"}', "completed"));
    expect(await callAI("x", [])).toBe('{"reply":"كامل"}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after a second incomplete reply instead of passing half a JSON on", async () => {
    fetchMock.mockResolvedValueOnce(stream("a", "incomplete")).mockResolvedValueOnce(stream("b", "incomplete"));
    await expect(callAI("x", [])).rejects.toBeInstanceOf(AiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a complete reply", async () => {
    fetchMock.mockResolvedValueOnce(stream("تم", "completed"));
    expect(await callAI("x", [])).toBe("تم");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops at the daily cap", async () => {
    vi.stubEnv("AI_DAILY_CAP", "1");
    fetchMock.mockResolvedValue(stream("تم", "completed"));
    await callAI("x", []);
    await expect(callAI("x", [])).rejects.toMatchObject({ status: 429 });
  });
});
