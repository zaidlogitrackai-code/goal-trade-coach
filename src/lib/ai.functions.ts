import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AiError, BASE_PERSONA, callAI } from "./ai.server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
type Sb = SupabaseClient<Database>;

async function buildContext(sb: Sb) {
  const [s, t, r, st] = await Promise.all([
    sb.from("trading_settings").select("*").maybeSingle(),
    sb.from("trades").select("symbol,direction,status,pnl,risk_amount,emotion,checklist_passed,opened_at,strategy_id").order("opened_at", { ascending: false }).limit(40),
    sb.from("trading_rules").select("title,description,active").eq("active", true),
    sb.from("strategies").select("id,name,description,entry_conditions,exit_conditions,allowed"),
  ]);
  return `بيانات المتداول (استخدمها فقط كسياق):
الإعدادات والحدود: ${JSON.stringify(s.data ?? {})}
القواعد الفعالة: ${JSON.stringify(r.data ?? [])}
الاستراتيجيات: ${JSON.stringify(st.data ?? [])}
آخر الصفقات: ${JSON.stringify(t.data ?? [])}`;
}

function fail(e: unknown): never {
  if (e instanceof AiError) throw new Error(e.message);
  console.error(e);
  throw new Error("صار خطأ غير متوقع، حاول مرة ثانية.");
}

export const analyzeChart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    image: z.string().startsWith("data:image/").max(8_000_000),
    symbol: z.string().max(30).optional().default(""),
    timeframe: z.string().max(20).optional().default(""),
    question: z.string().max(2000).optional().default(""),
  }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const ctx = await buildContext(context.supabase);
      const prompt = `حلّل صورة الشارت المرفقة. الأصل: ${data.symbol || "غير محدد"}، الفريم: ${data.timeframe || "غير محدد"}.
${data.question ? `سؤال المتداول: ${data.question}` : ""}
رتّب الرد بهذه العناوين: الاتجاه العام، الدعوم والمقاومات، النماذج والإشارات، سيناريو شراء محتمل (دخول/وقف/هدف)، سيناريو بيع محتمل، مدى توافقه مع استراتيجياتي وقواعدي، نسبة المخاطرة للعائد، الخلاصة (ادخل/انتظر/تجنب) مع السبب.`;
      const result = await callAI(`${BASE_PERSONA}\n\n${ctx}`, [{ role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_image", image_url: data.image }] }]);
      const { data: row, error } = await context.supabase.from("chart_analyses").insert({ user_id: context.userId, symbol: data.symbol || null, timeframe: data.timeframe || null, question: data.question || null, result }).select().single();
      if (error) throw error;
      return row;
    } catch (e) { fail(e); }
  });

export const coachReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid(), message: z.string().min(1).max(4000) }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const sb = context.supabase;
      const { error: e1 } = await sb.from("coach_messages").insert({ user_id: context.userId, thread_id: data.threadId, role: "user", content: data.message });
      if (e1) throw e1;
      const { data: hist } = await sb.from("coach_messages").select("role,content").eq("thread_id", data.threadId).order("created_at").limit(40);
      const ctx = await buildContext(sb);
      const input = (hist ?? []).map((m) => ({ role: m.role, content: m.content }));
      const reply = await callAI(`${BASE_PERSONA}\nأنت هنا "المدرب الذكي": راجع سلوك المتداول، اسأله أسئلة توضيحية عند الحاجة، وساعده يبني ويحسّن قواعده واستراتيجيته بنفسه.\n\n${ctx}`, input);
      await sb.from("coach_messages").insert({ user_id: context.userId, thread_id: data.threadId, role: "assistant", content: reply });
      const update: { updated_at: string; title?: string } = { updated_at: new Date().toISOString() };
      if ((hist ?? []).length <= 1) update.title = data.message.slice(0, 40);
      await sb.from("coach_threads").update(update).eq("id", data.threadId);
      return { reply };
    } catch (e) { fail(e); }
  });

export const reportSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ period: z.string().max(40), stats: z.string().max(20000) }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const ctx = await buildContext(context.supabase);
      const text = await callAI(`${BASE_PERSONA}\n\n${ctx}`, [{ role: "user", content: `اكتب تقرير أداء لفترة "${data.period}" بناءً على هذه الأرقام: ${data.stats}\nالعناوين: الملخص، نقاط القوة، الأخطاء المتكررة، الالتزام بالقواعد والمخاطر، ٣ خطوات عملية للفترة القادمة.` }]);
      return { text };
    } catch (e) { fail(e); }
  });

const TRADE_SCHEMA = {
  type: "json_schema", name: "trades", strict: true,
  schema: {
    type: "object", additionalProperties: false, required: ["trades"],
    properties: {
      trades: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          required: ["action", "symbol", "direction", "entry", "sl", "tp", "size", "risk", "exit_price", "pnl", "strategy", "emotion", "notes"],
          properties: {
            action: { type: "string", enum: ["open", "close"] },
            symbol: { type: ["string", "null"] },
            direction: { type: ["string", "null"], enum: ["long", "short", null] },
            entry: { type: ["number", "null"] }, sl: { type: ["number", "null"] }, tp: { type: ["number", "null"] },
            size: { type: ["number", "null"] }, risk: { type: ["number", "null"] },
            exit_price: { type: ["number", "null"] }, pnl: { type: ["number", "null"] },
            strategy: { type: ["string", "null"] }, emotion: { type: ["string", "null"] }, notes: { type: ["string", "null"] },
          },
        },
      },
    },
  },
};

export const parseTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    text: z.string().max(4000).optional().default(""),
    image: z.string().startsWith("data:image/").max(8_000_000).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    if (!data.text.trim() && !data.image) throw new Error("اكتب وصف الصفقة أو ارفع صورة.");
    try {
      const [st, open] = await Promise.all([
        context.supabase.from("strategies").select("name"),
        context.supabase.from("trades").select("symbol,direction,entry_price").eq("status", "open"),
      ]);
      const instructions = `استخرج الصفقات من كلام المتداول أو الصورة (لقطة منصة/شارت). لكل صفقة: action="open" لصفقة جديدة، أو "close" إذا يقول إنه أقفل صفقة. symbol بالإنجليزي بصيغة المنصات (الذهب=XAUUSD، بتكوين=BTCUSD، يورو دولار=EURUSD). direction long للشراء وshort للبيع. risk مبلغ المخاطرة بالعملة. strategy يجب أن يكون أحد هذه الأسماء بالضبط أو null: ${JSON.stringify((st.data ?? []).map((x) => x.name))}. emotion واحد من: هادئ، واثق، متوتر، متحمس، خائف، غاضب، طمع، أو null. الصفقات المفتوحة حالياً: ${JSON.stringify(open.data ?? [])}. لا تخترع أرقام غير مذكورة — استخدم null. notes ملخص قصير بالعربي.`;
      const content: Record<string, unknown>[] = [{ type: "input_text", text: data.text || "استخرج الصفقة من الصورة." }];
      if (data.image) content.push({ type: "input_image", image_url: data.image });
      const out = await callAI(instructions, [{ role: "user", content }], TRADE_SCHEMA);
      return JSON.parse(out) as { trades: unknown[] };
    } catch (e) { fail(e); }
  });
