// Server-only: Lovable AI Gateway (Responses API, streamed and consumed to final text).
const MODEL = "openai/gpt-6-astra";
const GATEWAY = "https://ai.gateway.lovable.dev/v1";
/** Longest we wait for one AI reply before telling the user to retry. */
const TIMEOUT_MS = 90_000;
const TRANSCRIBE_TIMEOUT_MS = 30_000;
/** Calls per server day; a runaway loop must not drain the AI credit. Override with AI_DAILY_CAP. */
const DEFAULT_DAILY_CAP = 400;

export class AiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

// Per server instance: enough to stop a loop, not an accounting record.
const usage = { day: "", calls: 0 };
function countCall() {
  const day = new Date().toISOString().slice(0, 10);
  if (usage.day !== day) { usage.day = day; usage.calls = 0; }
  const cap = Number(process.env["AI_DAILY_CAP"]) || DEFAULT_DAILY_CAP;
  if (usage.calls >= cap) throw new AiError("وصلت حد استخدام الذكاء اليوم، يرجع بكرة.", 429);
  usage.calls++;
}
/** Test hook: start a fresh day count. */
export function resetAiUsage() { usage.day = ""; usage.calls = 0; }

type Once = { text: string; incomplete: boolean };

async function callOnce(key: string, body: string): Promise<Once> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const timedOut = () => new AiError("الرد تأخر كثير، اضغط «أعد المحاولة».", 504);
  let res: Response;
  try {
    res = await fetch(`${GATEWAY}/responses`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "fetch" },
      body,
    });
  } catch (e) {
    if (signal.aborted) throw timedOut();
    console.error("AI gateway fetch failed", e);
    throw new AiError("تعذّر الاتصال بالمحلل، حاول مرة ثانية.", 502);
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    console.error("AI gateway error", res.status, text.slice(0, 500));
    if (res.status === 429) throw new AiError("ضغط كبير على الخدمة، جرّب بعد دقيقة.", 429);
    if (res.status === 402 || res.status === 403) throw new AiError("رصيد الذكاء الاصطناعي انتهى أو غير مفعّل. أضف رصيد من إعدادات Lovable.", res.status);
    throw new AiError("تعذّر الاتصال بالمحلل، حاول مرة ثانية.", res.status);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "", incomplete = false;
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try { chunk = await reader.read(); } catch (e) { if (signal.aborted) throw timedOut(); throw e; }
    const { done, value } = chunk;
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
        // A reply cut at the token limit is half a JSON or half a sentence: never hand it on.
        if (ev.type === "response.incomplete") incomplete = true;
        if (ev.type === "response.completed" || ev.type === "response.incomplete") {
          const u = ev.response?.usage;
          if (u) console.info("[ai] usage", { in: u.input_tokens, out: u.output_tokens, status: ev.response?.status, reason: ev.response?.incomplete_details?.reason ?? null });
        }
      } catch (e) { if (e instanceof AiError) throw e; }
    }
  }
  return { text: text.trim(), incomplete };
}

export async function callAI(instructions: string, input: Record<string, unknown>[], format?: Record<string, unknown>): Promise<string> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new AiError("خدمة الذكاء غير مهيأة.", 401);
  const body = JSON.stringify({
    model: MODEL, instructions, input, stream: true, store: false,
    reasoning: { effort: "low" },
    ...(format ? { text: { format } } : {}),
  });
  countCall();
  let r = await callOnce(key, body);
  if (r.incomplete) {
    console.warn("[ai] incomplete reply, retrying once");
    countCall();
    r = await callOnce(key, body);
    if (r.incomplete) throw new AiError("الرد انقطع قبل ما يكمل، اضغط «أعد المحاولة».", 500);
  }
  if (!r.text) throw new AiError("ما وصل رد من المحلل، حاول مرة ثانية.", 500);
  return r.text;
}

/** A voice note to Arabic text, through the same gateway key. */
export async function transcribe(audioBase64: string, mimeType: string): Promise<string> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new AiError("خدمة الذكاء غير مهيأة.", 401);
  countCall();
  const bin = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
  const mime = mimeType.split(";")[0]!;
  const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : mime.includes("wav") ? "wav" : "webm";
  const form = new FormData();
  form.append("model", "openai/gpt-transcribe");
  form.append("file", new File([bin], `voice.${ext}`, { type: mime }));
  form.append("response_format", "json");
  form.append("language", "ar");
  const signal = AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${GATEWAY}/audio/transcriptions`, { method: "POST", signal, headers: { Authorization: `Bearer ${key}` }, body: form });
  } catch (e) {
    if (signal.aborted) throw new AiError("التفريغ تأخر كثير، جرّب تسجيل أقصر.", 504);
    console.error("transcribe fetch failed", e);
    throw new AiError("ما قدرت أفهم الرسالة الصوتية، جرّب مرة ثانية.", 502);
  }
  if (!res.ok) {
    console.error("transcribe error", res.status, (await res.text().catch(() => "")).slice(0, 300));
    if (res.status === 402 || res.status === 403) throw new AiError("رصيد الذكاء الاصطناعي انتهى أو غير مفعّل.", res.status);
    throw new AiError("ما قدرت أفهم الرسالة الصوتية، جرّب مرة ثانية.", res.status);
  }
  const j = (await res.json()) as { text?: string };
  const text = (j.text ?? "").trim();
  if (!text) throw new AiError("ما سمعت شي بالتسجيل.", 422);
  return text;
}

export const BASE_PERSONA = `أنت مساعد تداول شخصي لهادي العجمي داخل "نظام هادي". تكلم بالعربي (لهجة خليجية بسيطة مقبولة)، باختصار ووضوح، واستخدم عناوين ونقاط. ركّز على الانضباط وإدارة المخاطر واحترام قواعد المتداول. لا تعطِ وعوداً بالربح، ولا تنفذ أي صفقات. وضّح دائماً أن القرار النهائي للمتداول.`;

/** He reads on an iPhone: short lines, no wide tables unless he asked for a list. */
export const PHONE_FORMAT = `- شاشة جوال: أسطر قصيرة، فقرة ٣ أسطر بالكثير، الأرقام المهمة **بخط عريض**، بدون جداول عريضة إلا لقائمة أصول، وبدون عناوين كبيرة.`;
