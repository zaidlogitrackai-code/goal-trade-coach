// Server-only: Lovable AI Gateway (Responses API, streamed and consumed to final text).
const MODEL = "openai/gpt-6-astra";

export class AiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function callAI(instructions: string, input: Record<string, unknown>[]): Promise<string> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new AiError("خدمة الذكاء غير مهيأة.", 401);
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({
      model: MODEL, instructions, input, stream: true, store: false,
      reasoning: { effort: "low" },
    }),
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    console.error("AI gateway error", res.status, body.slice(0, 500));
    if (res.status === 429) throw new AiError("ضغط كبير على الخدمة، جرّب بعد دقيقة.", 429);
    if (res.status === 402 || res.status === 403) throw new AiError("رصيد الذكاء الاصطناعي انتهى أو غير مفعّل. أضف رصيد من إعدادات Lovable.", res.status);
    throw new AiError("تعذّر الاتصال بالمحلل، حاول مرة ثانية.", res.status);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const ev = JSON.parse(data);
        if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") text += ev.delta;
        if (ev.type === "response.failed" || ev.type === "error") throw new AiError("فشل التحليل، حاول مرة ثانية.", 500);
      } catch (e) { if (e instanceof AiError) throw e; }
    }
  }
  if (!text.trim()) throw new AiError("ما وصل رد من المحلل، حاول مرة ثانية.", 500);
  return text.trim();
}

export const BASE_PERSONA = `أنت مساعد تداول شخصي لهادي العجمي داخل "نظام هادي". تكلم بالعربي (لهجة خليجية بسيطة مقبولة)، باختصار ووضوح، واستخدم عناوين ونقاط. ركّز على الانضباط وإدارة المخاطر واحترام قواعد المتداول. لا تعطِ وعوداً بالربح، ولا تنفذ أي صفقات. وضّح دائماً أن القرار النهائي للمتداول.`;
