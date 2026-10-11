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

const AGENT_SCHEMA = {
  type: "json_schema", name: "agent", strict: true,
  schema: {
    type: "object", additionalProperties: false, required: ["reply", "actions"],
    properties: {
      reply: { type: "string" },
      actions: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: ["type", "summary", "data"],
          properties: {
            type: { type: "string", enum: ["update_settings", "add_strategy", "add_rule", "create_trade", "close_trade", "add_note"] },
            summary: { type: "string" },
            data: { type: "string" },
          },
        },
      },
    },
  },
};

const AGENT_GUIDE = `أنت "المدرب الذكي" ومساعد المتداول الشخصي، وعندك صلاحية تقترح تنفيذ أي شيء في النظام نيابة عنه.
مهمتك: تحلل صفقاته معه، تفكر معه، تنصحه، تمنعه من الطمع، وتلزمه بالهدف اليومي والأسبوعي والشهري وحدود الخسارة. إذا وصل لهدفه أو حد خسارته قل له يوقف بوضوح.
إذا ناقصك معلومة (استراتيجيته، حدوده، أهدافه) اسأله سؤال أو سؤالين واضحين.
عندما يطلب منك أو يذكر شيء يحتاج حفظ، أضف إجراء في actions (لا ينفذ إلا بعد موافقته بزر). data نص JSON بهذه الأشكال:
- update_settings: {"starting_balance","daily_target","max_daily_profit","max_daily_loss","max_trades_per_day","max_risk_per_trade","max_daily_risk","max_consecutive_losses","weekly_target","weekly_max_loss","monthly_target","monthly_max_loss","cooldown_minutes","currency","display_name"} (أرسل فقط الحقول المذكورة، أرقام موجبة)
- add_strategy: {"name","description","entry_conditions","exit_conditions","markets","timeframes"}
- add_rule: {"title","description"}
- create_trade: {"symbol" (مثل XAUUSD، أو null إذا ما ذكره),"direction":"long"|"short","entry_price","stop_loss","take_profit","position_size","risk_amount","strategy" (اسم استراتيجية موجودة أو null),"emotion","notes","status":"open"|"closed","pnl" (للصفقة المنتهية، سالب للخسارة),"exit_price"}
- close_trade: {"symbol" (أو null),"pnl" (سالب للخسارة),"exit_price","notes"} — إذا ما فيه صفقة مفتوحة تنسجل كصفقة منتهية تلقائياً.
- add_note: {"title","content","category"}
قواعد مهمة جداً:
1. أنت لا تحفظ أي شيء بنفسك. لا تقل أبداً "سجلتها" أو "تم الحفظ". قل "جهزت لك زر الموافقة تحت" فقط إذا أضفت فعلاً إجراء في actions.
2. إذا طلب تسجيل صفقة (بنص أو صورة)، لازم تضيف create_trade في نفس الرد بالمعلومات المتوفرة حتى لو ناقص الرمز أو الاتجاه (حط null أو long). الصفقة المنتهية بربح أو خسارة: status "closed" مع pnl. لا تستبدل الصفقة بملاحظة add_note.
3. إذا قال "سجلها" أو "نفذ" لشيء ذكرتموه قبل، جهّز الإجراء الآن من المحادثة السابقة بدون ما تعيد الأسئلة.
4. اقرأ الصور المرفقة بعناية واستخرج منها كل الصفقات (الرمز، الاتجاه، الدخول، الخروج، الربح).
لا تخترع أرقام ما قالها ولا ظهرت بالصورة. summary جملة عربية قصيرة تشرح الإجراء. reply ردك بالعربي بصيغة markdown مختصر. إذا ما فيه شي يُحفظ خل actions فاضية.`;

async function runAgent(sb: Sb, extra: string, input: Record<string, unknown>[]) {
  const ctx = await buildContext(sb);
  const out = await callAI(`${BASE_PERSONA}\n${AGENT_GUIDE}\n${extra}\n\n${ctx}\nالتاريخ الآن: ${new Date().toISOString()}`, input, AGENT_SCHEMA);
  const parsed = JSON.parse(out) as { reply: string; actions: { type: string; summary: string; data: string }[] };
  return { reply: parsed.reply || "تم.", actions: (parsed.actions ?? []).slice(0, 20) };
}

export const coachReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid(), message: z.string().min(1).max(4000), image: z.string().startsWith("data:image/").max(8_000_000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const sb = context.supabase;
      const { error: e1 } = await sb.from("coach_messages").insert({ user_id: context.userId, thread_id: data.threadId, role: "user", content: data.image ? `${data.message}\n📎 (صورة مرفقة)` : data.message });
      if (e1) throw e1;
      const { data: hist } = await sb.from("coach_messages").select("role,content").eq("thread_id", data.threadId).order("created_at").limit(40);
      const input: Record<string, unknown>[] = (hist ?? []).map((m) => ({ role: m.role, content: m.content }));
      if (data.image) input.push({ role: "user", content: [{ type: "input_text", text: data.message }, { type: "input_image", image_url: data.image }] });
      const { reply, actions } = await runAgent(sb, "", input);
      const { error: e2 } = await sb.from("coach_messages").insert({ user_id: context.userId, thread_id: data.threadId, role: "assistant", content: reply, actions: actions.length ? actions : null });
      if (e2) throw e2;
      const update: { updated_at: string; title?: string } = { updated_at: new Date().toISOString() };
      if ((hist ?? []).length <= 1) update.title = data.message.slice(0, 40);
      await sb.from("coach_threads").update(update).eq("id", data.threadId);
      return { reply };
    } catch (e) { fail(e); }
  });

export const setupPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ text: z.string().min(1).max(8000) }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      return await runAgent(context.supabase, `المتداول جديد ويكتب لك وصف كامل لنظامه. حوّل كل ما ذكره إلى إجراءات: update_settings واحد يجمع كل الحدود والأهداف والرصيد والعملة، ثم add_strategy لكل استراتيجية، add_rule لكل قاعدة، وأي صفقات مذكورة. في reply لخّص ما فهمته واسأله عن أهم شيء ناقص (مثل حد الخسارة اليومي) إن لم يذكره.`, [{ role: "user", content: data.text }]);
    } catch (e) { fail(e); }
  });

export const morningGreeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const sb = context.supabase;
      const day = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10); // Riyadh date
      const { data: existing } = await sb.from("notifications").select("id").eq("kind", "morning").eq("day", day).maybeSingle();
      if (existing) return { created: false };
      const ctx = await buildContext(sb);
      const body = await callAI(`${BASE_PERSONA}\n\n${ctx}`, [{ role: "user", content: `اكتب رسالة صباحية قصيرة (٤-٦ أسطر) لهادي: صباح الخير، يعطيك العافية، سلام ودّي. ثم ملخص سريع لأمس (إن وجدت صفقات)، تذكير بالهدف اليومي والأسبوعي والشهري وحد الخسارة، ونصيحة واحدة ضد الطمع. اليوم ${day}.` }]);
      const { error } = await sb.from("notifications").insert({ user_id: context.userId, kind: "morning", day, title: "صباح الخير يا هادي ☀️", body });
      if (error && error.code !== "23505") throw error;
      return { created: true };
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
    type: "object", additionalProperties: false, required: ["message", "trades"],
    properties: {
      message: { type: "string" },
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
      const imageGuide = data.image ? `
قراءة الصورة:
- الرمز من عنوان الشارت أعلى اليسار (مثل XAUUSD أو GOLD أو BTCUSDT) والفريم بجانبه.
- أداة Long/Short Position في TradingView (مستطيل أخضر/أزرق فوق مستطيل أحمر أو العكس): الدخول هو الحد الفاصل بين اللونين، الوقف هو طرف المنطقة الحمراء، والهدف هو طرف المنطقة الخضراء. المنطقة الخضراء فوق = long، تحت = short. اقرأ الأسعار من الملصقات أو من محور السعر يمين الشارت.
- خطوط الأوامر المفتوحة (Entry/SL/TP أو خطوط أفقية بملصقات سعر)، ونوافذ تأكيد الأمر، وسجل الصفقات في المنصات.
- إذا كانت الصورة شارت بدون صفقة مرسومة أو أرقام مقروءة، لا تخترع: أعد صفقة واحدة بما ظهر فعلاً (الرمز مثلاً) والباقي null، أو trades فارغة إذا لم يظهر شيء.` : "";
      const instructions = `استخرج الصفقات من كلام المتداول أو الصورة (لقطة منصة/شارت). لكل صفقة: action="open" لصفقة جديدة، أو "close" إذا يقول إنه أقفل صفقة. symbol بالإنجليزي بصيغة المنصات (الذهب=XAUUSD، بتكوين=BTCUSD، يورو دولار=EURUSD). direction long للشراء وshort للبيع. risk مبلغ المخاطرة بالعملة. strategy يجب أن يكون أحد هذه الأسماء بالضبط أو null: ${JSON.stringify((st.data ?? []).map((x) => x.name))}. emotion واحد من: هادئ، واثق، متوتر، متحمس، خائف، غاضب، طمع، أو null. الصفقات المفتوحة حالياً: ${JSON.stringify(open.data ?? [])}. لا تخترع أرقام غير مذكورة — استخدم null. notes ملخص قصير بالعربي.${imageGuide}
message: جملة عربية قصيرة للمتداول: ماذا قرأت، وما الناقص (مثل: "قرأت الرمز XAUUSD، لكن ما فيه دخول أو وقف واضح. ارسم أداة Long Position أو اكتب الأرقام.").`;
      const content: Record<string, unknown>[] = [{ type: "input_text", text: data.text || "استخرج الصفقة من الصورة." }];
      if (data.image) content.push({ type: "input_image", image_url: data.image, detail: "high" });
      const out = await callAI(instructions, [{ role: "user", content }], TRADE_SCHEMA);
      return JSON.parse(out) as { message: string; trades: import("./ai-trade").AiTrade[] };
    } catch (e) { fail(e); }
  });
