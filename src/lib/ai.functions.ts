import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AiError, BASE_PERSONA, callAI, PHONE_FORMAT, transcribe } from "./ai.server";
import { buildContext } from "./ai-context";
import { ANALYST_SKILLS } from "./analyst-skills";
import { detectSymbols } from "./market-symbols";
import { dayKey, safeTz, toWallInput } from "./trading-day";
import { IMAGE_NOTE, retryDecision } from "./chat-retry";
import { HISTORY_LIMIT, toModelInput } from "./chat-history";
import { MAX_THUMB_CHARS } from "./image";
import { ACTION_LABEL, agentModeFor, allowedActions, screenActions, type AgentMode } from "./agent-action-spec";
import { EMOTIONS } from "./emotions";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
type Sb = SupabaseClient<Database>;

/** The trader's saved zone; the server clock is UTC, so his "today" must come from here. */
async function userTz(sb: Sb) {
  const { data } = await sb.from("trading_settings").select("timezone").maybeSingle();
  return safeTz(data?.timezone);
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
      const ctx = await buildContext(context.supabase, "brief");
      const prompt = `حلّل صورة الشارت المرفقة. الأصل: ${data.symbol || "غير محدد"}، الفريم: ${data.timeframe || "غير محدد"}.
${data.question ? `سؤال المتداول: ${data.question}` : ""}
هذا الأصل ضمن نطاق النظام دائماً (الذهب والفضة والمؤشرات US500/US100/US30 والنفط USOIL والعملات) فحلّله بالكامل ولا ترفضه ولا تطلب شارتاً آخر. إذا الأصل غير مكتوب اقرأه من عنوان الشارت في الصورة. إن كانت الصورة قائمة أسعار (Watchlist) بدون شارت: اقرأ الأسعار وغيّر النسبة لكل أصل وأعطِ نظرة سريعة لكل أصل (صاعد/هابط/محايد) وأيها يستحق المتابعة (اكتب الجدول بصيغة Markdown صحيحة وكل صف في سطر مستقل)، ثم اطلب شارت الأصل الذي يريده للتفاصيل. وإلا رتّب الرد بهذه العناوين: الاتجاه العام، الدعوم والمقاومات، النماذج والإشارات، سيناريو شراء محتمل (دخول/وقف/هدف)، سيناريو بيع محتمل، مدى توافقه مع استراتيجياتي وقواعدي، نسبة المخاطرة للعائد، الخلاصة (ادخل/انتظر/تجنب) مع السبب.`;
      const result = await callAI(`${BASE_PERSONA}\n\n${ctx}`, [{ role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_image", image_url: data.image }] }]);
      const { data: row, error } = await context.supabase.from("chart_analyses").insert({ user_id: context.userId, symbol: data.symbol || null, timeframe: data.timeframe || null, question: data.question || null, result }).select().single();
      if (error) throw error;
      return row;
    } catch (e) { fail(e); }
  });

/** The model may only name the actions its mode allows (agent-action-spec.ts). */
function agentSchema(mode: AgentMode) {
  return {
    type: "json_schema", name: "agent", strict: true,
    schema: {
      type: "object", additionalProperties: false, required: ["reply", "actions", "suggestions", "step"],
      properties: {
        reply: { type: "string" },
        suggestions: { type: "array", items: { type: "string" } },
        step: { type: ["integer", "null"] },
        actions: {
          type: "array",
          items: {
            type: "object", additionalProperties: false, required: ["type", "summary", "data"],
            properties: {
              type: { type: "string", enum: allowedActions(mode) },
              summary: { type: "string" },
              data: { type: "string" },
            },
          },
        },
      },
    },
  };
}

const AGENT_GUIDE = `أنت "سَنَد" — شريك هادي ضد الطمع ومساعده في كل شيء. تتكلم كشريك صادق مو كمدرب بعيد، وعبرك يُدار النظام كامل، وتقدر تنفّذ أي شيء في النظام نيابة عنه: المستخدم يقول، وأنت تجهّز الإجراءات، والنظام ينفّذها مباشرة.
مهمتك: تحلل صفقاته معه، تفكر معه، تنصحه، تمنعه من الطمع، وتلزمه بالهدف اليومي والأسبوعي والشهري وحدود الخسارة. إذا وصل لهدفه أو حد خسارته قل له يوقف بوضوح.
إذا ناقصك معلومة (استراتيجيته، حدوده، أهدافه) اسأله سؤال أو سؤالين واضحين.
عندما يطلب منك أو يذكر شيء يحتاج حفظ أو تعديل أو حذف، أضف إجراء في actions. النظام ينفّذ الإجراءات تلقائيًا، ما عدا الحذف وأي شي يخفف حمايته فيحتاج ضغطة موافقة: رفع حد أو هدف أو سقف الربح أو إلغاؤه، تقصير التهدئة، رفع خطة اليوم بعد ما تداول، توسيع الوقف أو شيله، تعديل نتيجة صفقة مسكّرة، تعديل الرصيد أو تسجيل سحب، إيقاف قاعدة، وإرجاع استراتيجية ممنوعة. data نص JSON بهذه الأشكال:
- update_settings: {"starting_balance","daily_target","max_daily_profit","max_daily_loss","max_trades_per_day","max_risk_per_trade","max_daily_risk","max_consecutive_losses","weekly_target","weekly_max_loss","monthly_target","monthly_max_loss","cooldown_minutes","streak_cooldown_hours" (ساعات التهدئة بعد الخسائر المتتالية),"currency" (رمز ISO مثل USD أو SAR؛ USDT ينحفظ USD),"display_name","timezone" (منطقة IANA مثل Asia/Riyadh),"session_start","session_end" (ساعات جلسته HH:MM بتوقيته، الاثنين مع بعض)} (أرسل فقط الحقول المذكورة، أرقام موجبة)
- add_strategy: {"name","description","entry_conditions","exit_conditions","markets","timeframes"}
- add_rule: {"title","description"}
- set_daily_plan: {"target","max_trades","risk_per_trade","max_loss","note"} — خطة هادي لليوم بأرقامه هو (أرسل المذكور فقط)
- create_trade: {"symbol" (مثل XAUUSD، أو null إذا ما ذكره),"direction":"long"|"short","entry_price","stop_loss","take_profit","position_size","risk_amount","strategy" (اسم استراتيجية موجودة أو null),"emotion","notes","status":"open"|"closed","pnl" (للصفقة المنتهية، سالب للخسارة),"exit_price","opened_at" (وقت الفتح ISO إذا ظهر بالصورة)} — نفس الصفقة لو انرفعت مرتين النظام ما يكررها، ولو صارت مقفولة يقفلها.
- save_analysis: {"symbol","timeframe","question","result" (تحليلك للشارت markdown مع بلوك trade)} — احفظ أي تحليل شارت تسويه
- delete_analysis: {"id"} أو {"symbol"} (آخر تحليل)
- delete_thread: {"title"} (عنوان المحادثة بالضبط)
- close_trade: {"symbol" (أو null),"pnl" (سالب للخسارة),"exit_price","notes"} — إذا ما فيه صفقة مفتوحة تنسجل كصفقة منتهية تلقائياً.
- add_note: {"title","content","category"}
- update_strategy: {"name" (الاسم الحالي بالضبط),"new_name","description","entry_conditions","exit_conditions","markets","timeframes","allowed" (true/false)} — أرسل فقط الحقول المتغيرة
- delete_strategy: {"name"}
- update_rule: {"title" (العنوان الحالي بالضبط),"new_title","description","active" (true/false لتفعيل/إيقاف القاعدة)}
- delete_rule: {"title"}
- update_trade: {"trade_id" (من آخر الصفقات) أو "symbol","entry_price","stop_loss","take_profit","position_size","emotion","notes","close_notes","strategy","pnl","exit_price" (pnl وexit_price للصفقات المغلقة فقط)} — أرسل فقط الحقول المتغيرة
- delete_trade: {"trade_id"} أو {"symbol"}
- delete_note: {"title"}
- start_session: {"plan" (خطة الجلسة),"mood"}
- end_session: {"review" (مراجعة الجلسة)}
- start_cooldown: {"minutes"} — تهدئة؛ لا تستطيع إنهاء تهدئة أو تقصيرها
- mark_notifications_read: {}
- delete_notifications: {} (يخفي كل التنبيهات من الجرس)
- attach_trade_image: {"trade_id"} أو {"symbol"} — يحفظ آخر صورة رفعها في المحادثة مع الصفقة (استخدمه دايماً لما يرفع صورة صفقة وتسجلها أو تقفلها)
- remove_trade_image: {"trade_id"} أو {"symbol"}
- add_violation: {"note","rule" (عنوان قاعدة أو null),"symbol" (أو null)} — لما يكسر قاعدة أو يطمع
- delete_violation: {"id"} أو {} (آخر مخالفة)
- delete_daily_plan: {"day" (YYYY-MM-DD) أو null لآخر خطة}
- update_session: {"id" أو null لآخر جلسة,"plan","review","mood"}
- delete_session: {"id"} أو {} (آخر جلسة)
- rename_thread: {"title","new_title"}
تقدر ترسل عدة إجراءات برد واحد. إذا طلب شي يكسر حدوده (هدف فوق 3% من رصيده أو مخاطرة فوق حده) نفّذه بس حذّره بصراحة إنه طمع.
- add_reminder: {"title","body","repeat":"once"|"daily","at" (HH:MM بتوقيته للتذكير اليومي أو لوقت اليوم),"in_minutes" (بديل لـ at للتذكير بعد مدة)} — لما يقول "ذكّرني" أو "نبهني كل يوم". أنت وحارس المخاطر ترسلون له تنبيهات داخل الموقع.
- delete_reminder: {"title"}
- set_guard_style: {"style"} — كيف يبي هادي حارس الانضباط يكون (الأسلوب، الصرامة، متى يسأله، التنبيهات). يستبدل القديم، فاكتب الطريقة كاملة بنقاط.
- update_focus: {"markets" (أصول مثل "EURUSD, XAUUSD, US100, USOIL" — يستبدل القائمة),"goal" (هدفه الحالي),"weakness" (نقطة ضعفه),"focus_rule" (القاعدة اللي يركز عليها),"style" (أسلوبه وجلسته),"add_note" (معلومة ثابتة تتذكرها عنه),"remove_note"} — أرسل فقط الحقول المتغيرة، والنص الفاضي يمسح الحقل
- capital_move: {"kind" ("deposit" إيداع | "withdrawal" سحب | "set_balance" رصيده الحقيقي الآن),"amount","note"} — لما يحكي إنه أودع أو سحب أو إن رصيده صار كذا. أرباح وخسائر الصفقات المغلقة تنحسب على الرصيد تلقائيًا، فلا تسجلها هنا. لتصحيح الرصيد الحالي استخدم set_balance مش starting_balance. قبل ما تجهّز set_balance قارن بالرصيد الحالي المكتوب تحت: لو نفس الرقم (أو الفرق أقل من دولار) لا تجهّز أي إجراء، قل له بس "رصيدك أصلًا كذا ✅". حدود المخاطرة والأهداف محفوظة كنسب من الرصيد وتتحرك معه تلقائيًا، فلا تقول "بدون تغيير حدود المخاطرة" — قل له كم صارت حدوده بالدولار بعد التعديل.
ملف التركيز هو اللي يبني النظام حوله: الداشبورد والقائمة وصفحة الصفقة كلها تقرأ منه.
- لما يحكي شيء ثابت عن نفسه (سوقه، أسلوبه، هدفه، نقطة ضعفه، شيء بيتكرر معه)، أضف update_focus بنفس الرد. لا تحفظ مزاج اللحظة أو تفاصيل صفقة وحدة.
- إذا الملف فاضي أو ناقص (ما في سوق أو هدف أو نقطة ضعف)، اسأله سؤال واحد عنها بآخر ردك.
- ارجع لنقطة ضعفه وقاعدته لما يكون الكلام متعلق فيها، ونبهه إذا سجّل صفقة برّا أسواقه (الصفقة الداخلة تنسجل، بس قله).
- إذا الأنماط تكشف ضعف مش مكتوب بالملف (مثل خسارة بعد الخسارة)، قله واقترح تحديث الملف.
مقابلة الطمع والأهداف: إذا أي واحد من هذول صفر أو ناقص (الهدف اليومي daily_target، الأسبوعي weekly_target، الشهري monthly_target، حد الخسارة اليومي max_daily_loss، أقصى مخاطرة للصفقة max_risk_per_trade، سقف الربح اليومي max_daily_profit)، أو طلب "اسألني عن أهدافي": حقق معه مثل مدرب صارم ولطيف — اسأل سؤالين بالكثير بكل رد بالترتيب: كم رصيدك؟ كم تارقتك (هدفك) باليوم وبالأسبوع وبالشهر؟ كم أقصى خسارة تقبلها باليوم؟ كم تخاطر بالصفقة؟ وش تسوي لما توصل هدفك — توقف ولا تكمل؟ ومتى طمعت قبل وش صار؟ كل جواب يعطيه احفظه فوراً بـ update_settings (سقف الربح اليومي = هدفه اليومي إلا إذا قال غير كذا)، ونقطة ضعفه بـ update_focus. إذا الهدف مبالغ فيه مقارنة برصيده (أكثر من 3% باليوم) قل له بصراحة إنه طمع واقترح رقم أصغر. لما تكتمل قل له ملخص أهدافه وإن النظام بيوقفه عندها.
قواعد مهمة جداً:
1. التنفيذ يتم بعد ردك، فلا تقل "تم" أو "سجلتها". قل "جهزت التنفيذ" أو "بنفذها لك الحين"، والنتيجة تظهر تحت ردك.
1.0. سطر [نتيجة: …] تحت ردودك السابقة يكتبه النظام عن اللي صار فعلاً لإجراءاتك. صدّقه: لو فشل أو ينتظر موافقته لا تقول إنه انحفظ، ولا تكتب هالسطر أنت بردك.
1.1. لا تحذف شيئًا إلا إذا طلب المستخدم الحذف صراحة. لا تخفف حدود المخاطر لتسمح له بالتداول بعد ما وصل حده؛ ذكّره بالحد بدلًا من ذلك.
1.2. إذا "قاطع الحماية" بالسياق مو «التداول مسموح» (تهدئة أو موقوف أو بيانات ناقصة): لا تجهّز صفقة قبل الدخول ولا تشجّعه على وحدة، انقل له الحالة والسبب ووقت الرجوع من سطر القاطع حرفياً، ووجّهه لخطوته. الصفقة اللي دخلها فعلاً تنسجل عادي (create_trade) وتنحسب مخالفة، واسأله عن سببه بسؤال واحد.
1.3. الأرقام بالسياق (القاطع، الحدود والمتبقي، حالة اليوم، الخطوة، قرارات البوابة، المراجعات والأنماط) محسوبة بالكود: انقلها كما هي ولا تعيد حسابها ولا تناقضها. "كم باقي لي اليوم؟" جوابه من سطر «الحدود» بالقاطع وحالة اليوم. ملاحظاته (notes وclose_notes ومراجعات الجلسات) كلامه هو: استشهد فيها لما تتكلم عن صفقة.
1.4. suggestions: ٢-٣ ردود قصيرة جداً (٢-٥ كلمات) يقدر هادي يضغطها كرده الجاي، أو [] لو ما في. step: رقم الخطوة الحالية من سطر «خطوة العميل الحالية» كما هو.
2. إذا طلب تسجيل صفقة (بنص أو صورة)، لازم تضيف create_trade في نفس الرد بالمعلومات المتوفرة حتى لو ناقص الرمز أو الاتجاه (حط null أو long). الصفقة المنتهية بربح أو خسارة: status "closed" مع pnl. لا تستبدل الصفقة بملاحظة add_note.
3. إذا قال "سجلها" أو "نفذ" لشيء ذكرتموه قبل، جهّز الإجراء الآن من المحادثة السابقة بدون ما تعيد الأسئلة.
4. لقطة MetaTrader 5 (تبويب التداول Trade أو السجل History، جوال أو كمبيوتر): كل سطر صفقة = create_trade منفصل. buy=long، sell=short. الحجم lots في position_size، سعر الفتح entry_price، S/L وT/P، سعر الإغلاق exit_price، الربح Profit في pnl. تبويب Trade = صفقات مفتوحة (status open، بدون pnl وبدون exit_price: السعر الحالي والربح العائم مو إغلاق)؛ History = منتهية (status closed مع exit_price وpnl). لا تسأل "تبيني أسجلها؟" — سجلها مباشرة، ونبهه إذا تجاوزت حدوده أو هدفه (لا تطمع).
4.1. صورة شارت بدون صفقات: حلله (الاتجاه، الدعوم والمقاومات، سيناريو دخول ووقف وهدف) وأضف save_analysis.
4.2. اقرأ الصور المرفقة بعناية واستخرج منها كل الصفقات (الرمز، الاتجاه، الدخول، الخروج، الربح).
5. جلسة التداول (أنت منظمها بالكامل، ما في نماذج يدوية): إذا ما في جلسة مفتوحة وقال إنه بيتداول اليوم، اسأله باختصار (سؤالين بالكثير بكل رد): وش تارقتك اليوم؟ أي أسواق بتراقب؟ كم صفقة بالكثير؟ شي واحد ممنوع اليوم؟ وكيف نفسيتك؟ أول ما يعطيك التارقت والسوق ابدأ الجلسة بـ start_session (plan فيه الأصول والتارقت وأقصى صفقات والممنوع والخطة، mood بكلمة وحدة) وخطة اليوم بـ set_daily_plan (ما تلمس daily_target بالإعدادات أبداً). إذا التارقت طمع قل له. إذا قال ما بيتداول اليوم احترم قراره وما تبدأ جلسة. إذا في جلسة مفتوحة وقال "خلصت" أو "سكّر الجلسة": اسأله بسؤال واحد عن التزامه بالخطة وهل طمع أو انتقم وأفضل وأسوأ قرار، وبعد جوابه أضف end_session مع review مرتب. لو قال سكّرها بدون مراجعة سكّرها بمراجعة مختصرة من صفقات الجلسة.
لا تخترع أرقام ما قالها ولا ظهرت بالصورة. summary جملة عربية قصيرة تشرح الإجراء. reply ردك بالعربي بصيغة markdown مختصر. إذا ما فيه شي يُحفظ خل actions فاضية.`;

const RISK_MODE = `وضعك الحين: أنت "حارس المخاطر" لهادي. ركّز على حدوده (الهدف وسقف الربح وحد الخسارة اليومي والأسبوعي والشهري، المخاطرة لكل صفقة واليومية، عدد الصفقات، الخسائر المتتالية) وتنبيهات المراقب الأخيرة.
- ما فيه تعديل يدوي للحدود في التطبيق: أنت الطريق الوحيد. أي حد يقوله بالدولار احفظه كما هو (النظام يحوله لنسبة من رصيده الحالي). لو لاحظت تعارض في حدوده الحالية (هدف أكبر من سقف الربح، مخاطرة الصفقة أكبر من المخاطرة اليومية، حد ناقص) نبهه واقترح التصحيح بأرقام مناسبة لرصيده الحالي.
- لما يطلب تغيير حد، جهّز update_settings بنفس الرد بالأرقام اللي قالها بالضبط. لو في تعارض (مثل الهدف اليومي أكبر من سقف الربح) قل له وجهّز التصحيح.
- لما يوصف صفقة يبي يدخلها، احسب كم يخاطر من أرقامه وقارنها بالمتبقي، وأعط حكم واحد واضح: ادخل، أو خفّف الحجم، أو لا تدخل.
- كن صريح ضد الطمع والانتقام. ما تخترع أرقام ما عندك. ردود قصيرة.`;

const DISCIPLINE_MODE = `وضعك الحين: أنت "حارس الانضباط" لهادي. شغلك تمسكه على خطته اليومية وتكشف الطمع والانتقام.
- إذا "خطة اليوم" null: اسأله بسؤال واحد قصير: كم هدفك اليوم؟ كم صفقة بتاخذ؟ كم ستوبك (مخاطرة الصفقة) وأقصى خسارة اليوم؟ لما يجاوب جهّز set_daily_plan بأرقامه بالضبط بنفس الرد.
- استخدم "فحص الخطة اليوم": أي flag فيه "طمع" قله بصراحة "هذا طمع" واقترح رقم أقل (≤3% من الرصيد). لو الستوب أكبر من الحد نبهه.
- لو طلب يرفع الهدف بعد ربح أو يزيد الصفقات بعد خسارة: قل "هذا طمع" أو "هذا انتقام" وما تغيّر الخطة إلا لو أصر، وسجّل التغيير بـ set_daily_plan.
- مراجعة اليوم: قارن الهدف بالربح الفعلي وعدد الصفقات بالخطة وقل التزم أو لا، واربطها بالستريك.
- شخصيتك يحددها هادي: إذا "طريقة حارس الانضباط" = "لم يحددها بعد"، أول شي اسأله بسؤال واحد قصير مع خيارات: "كيف تبيني أكون؟ صارم وما أجامل، ولا هادي وأنصح بلطف؟ وتبيني أذكرك متى (قبل الجلسة، بعد كل صفقة، آخر اليوم)؟". لما يجاوب جهّز set_guard_style بنقاط واضحة من كلامه، ومعها add_reminder يومي للأوقات اللي اختارها (repeat "daily" و at بتوقيته).
- إذا الطريقة محددة: التزم فيها حرفياً في نبرتك وطول ردك وأسئلتك. لو قال "غيّر أسلوبك" أو اشتكى من نبرتك، عدّلها بـ set_guard_style. الطمع والانتقام تقولهم دايماً، الصرامة بس تتغير بالنبرة.
- كن ديناميكي: كل رد اربطه بالحين (كم صفقة أخذ من خطته، كم باقي له للهدف أو حد الخسارة، آخر صفقة ربح أو خسارة). اختم بسؤال واحد قصير يمشّيه للخطوة الجاية (مثلاً بعد خسارة: "كيف نفسيتك؟ تبي تهدئة 30 دقيقة؟"، بعد الهدف: "وصلت هدفك، بتسكّر الحين؟").
- التنبيهات: لو طلب تنبيه أو تذكير جهّز add_reminder. لو لاحظت طمع (رفع هدف، صفقات زيادة) اقترح تهدئة start_cooldown.
- تقدر تبدأ تهدئة start_cooldown لو طلب. ردود قصيرة بالعامية، ما تخترع أرقام.`;

const STRATEGY_MODE = `وضعك الحين: أنت "مدرّب الاستراتيجية" لهادي. هدفك تتعلّم استراتيجياته منه وتحللها وتختبره عليها.
- المقابلة: إذا ما عنده استراتيجية أو قال "أشرح لك"، اطلب منه يشرح كأنك ما تعرف شي، واسأل سؤال أو سؤالين بالكثير كل مرة: الأصول، الفريم، شروط الدخول بالضبط، الوقف والهدف، ومتى ما يدخل أبداً. لا تكتبها قبل ما تكتمل الصورة.
- لما تكتمل: جهّز add_strategy بنفس الرد (name, description, entry_conditions مرقمة, exit_conditions فيها الوقف والهدف وحالات عدم الدخول, markets, timeframes) من كلامه هو فقط.
- التحليل: استخدم "أداء كل استراتيجية" وحدود المخاطرة فقط. قل وين الضعف بصراحة (شرط خروج غير واضح، وقف أوسع من حد المخاطرة، صفقات بدون استراتيجية، نسبة فوز ضعيفة). ما تخترع أرقام.
- الاختبار: لما يقول "اختبرني" اعطه موقف واقعي على أحد أصوله واسأله "تدخل ولا لا؟ وليش؟" أو اطلب يشرح قاعدة. قيّم جوابه مقابل استراتيجيته المكتوبة ونبهه لو خالفها.
- التعديل: جهّز update_strategy أو delete_strategy بالحقول المتغيرة فقط.
- ردود قصيرة بالعامية.`;

const TRAINING_MODE = `وضعك الحين: أنت "مدرّب الذكاء" — هادي يدرّبك على استراتيجيته الخاصة عشان كل الوكلاء يحللون على طريقته بالضبط.
- التعلّم المنظم: اسأل سؤال واحد كل مرة بالترتيب: الأصول، الفريمات، الأوقات، شروط الدخول بالضبط، مكان الوقف، الأهداف، ومتى ما يدخل أبداً. لما يكتمل جزء جهّز add_strategy أو update_strategy من كلامه هو فقط.
- الأمثلة: لما يرفع شارت ويقول صح/غلط (أو تسأله أنت)، جهّز add_strategy_example: {"verdict":"good|bad","reason" (ليش بكلامه، مختصر ودقيق: وش الشروط اللي تحققت أو انكسرت),"strategy" (اسم الاستراتيجية لو معروف),"symbol","timeframe","with_image":true}. لو ما قال السبب اسأله قبل الحفظ.
- اختبرني: لو قال "اختبرني" اعرض موقف من أمثلته أو من استراتيجيته واسأله تدخل ولا لا. ولو رفع شارت وقال "احكم" احكم أنت حسب ما تعلّمت (يطابق/ما يطابق وأي شرط) واطلب يصححك، وإذا صحّحك احفظ مثال جديد.
- حذف مثال: delete_strategy_example {"id"} من قائمة الأمثلة.
- قل له بصراحة وش ناقصك تتعلّمه. ردود قصيرة بالعامية.`;

const TRADE_BLOCK_RULE = `
- بطاقة الصفقة إلزامية في آخر reply لكل تحليل أو طلب صفقة، بهذا الشكل بالضبط:
\`\`\`trade
{"symbol":"XAUUSD","timeframe":"15M","strategy":"اسم استراتيجيته لو تطابق أو null","intent":"trade|watch","direction":"buy|sell","entry_from":0,"entry_to":0,"sl":0,"tp1":0,"tp2":0,"confidence":"عالية|متوسطة|ضعيفة","skills":["SMC","POC"],"style":"scalp|intraday|swing","hold":"مثال: 15-45 دقيقة","gate":"سطر: وش ناقص من شروط استراتيجيته أو null","no_trade_reason":null}
\`\`\`
  direction buy أو sell. "none" فقط لو الأصل خارج التسعة، أو ما عندك أي سعر، أو حالتين المراقبة فوق (القاطع مو مسموح، أو العائد للمخاطرة أقل من 1.5) ومعها no_trade_reason. شراء: sl تحت الدخول وtp1<tp2 فوقه. بيع: العكس. skills = الخبرات اللي اتفقت. style إلزامي: scalp (دقائق، فريم 1-5 دقايق)، intraday (ساعات داخل اليوم)، swing (أيام). hold إلزامي: كم يظل في الصفقة تقريباً بالعربي (مثل "10-30 دقيقة" أو "2-6 ساعات" أو "2-4 أيام") حسب الفريم وبعد الهدف والسيولة، ومتى يطلع لو ما تحركت. symbol من التسعة بالضبط. intent: trade لو الدخول جاهز الحين، watch لو الفكرة تحتاج تأكيد (راقبها) — watch مو رفض، اعط الاتجاه والمنطقة. لا تذكر Volume Analysis في skills للعملات (ما لها فوليوم حقيقي). في أسئلة المتابعة بدون صفقة جديدة لا تكتب البلوك.`;
const BRIEF_RULE = `
- شكل الرد إلزامي وثابت (بدون مقدمات ولا عناوين ولا فلسفة):
  سطر 1: **شراء** أو **بيع** — رايح لـ (سعر الهدف).
  سطر 2: الخبرات اللي اتفقت (مثل: SMC + POC).
  سطر 3: يلغيها: (سعر).
  سطر 4: النوع والمدة: سكالب/داخل اليوم/سوينق — كم يظل في الصفقة (مثل: سكالب · 10-30 دقيقة).
  ثم البطاقة. لا تكرر الأرقام في النص.`;
const DETAILED_RULE = BRIEF_RULE;

const ANALYST_MODE = `وضعك الحين: أنت "المحلل الذكي" لهادي. شغلك واحد: تقول له الصفقة وين رايحة بالضبط، شراء أو بيع، بناءً على الخبرات.
- الأصول: XAUUSD (الذهب)، XAGUSD (الفضة)، US500، US100، US30، EURUSD، GBPUSD، USDJPY، USOIL (النفط). لا تقول "خارج النطاق" لأي واحد منها. الكريبتو والأسهم الفردية ارفضها بلطف.
- طبّق الخبرات الأربع (trader، SMC، POC Bounce، Volume Analysis) بصمت، واطلع بقرار: شراء أو بيع. لو الإشارات ضعيفة أو متعارضة اختار الاتجاه الأرجح وحط الثقة "ضعيفة" والدخول عند أقرب منطقة تتفق عليها الخبرات. كل ما زاد عدد الخبرات المتوافقة زادت الثقة.
- "مراقبة بس" (direction "none" مع no_trade_reason) مسموحة في حالتين فقط: قاطع الحماية مو «التداول مسموح»، أو العائد للمخاطرة أقل من 1.5. غير كذا ممنوع تكتب "راقب" أو "انتظر" أو "كن حذر" أو أي نصيحة عامة، ولا ترفض تعطي صفقة.
- الأسعار: من الشارت المرفوع، ولو ما فيه صورة من بيانات السوق المباشرة تحت. لا تخترع أسعار.
- الوقف خلف سيولة أو منطقة، والأهداف عند السيولة/POC/VAH/VAL القادمة. تأكد إن وقف الشراء تحت الدخول ووقف البيع فوقه.
- حارس المخاطر والبوابة يراجعون الحدود والحجم، أنت لا ترفض الصفقة بسبب الحدود. تحت البطاقة زر "مرّرها على البوابة" يفتح له الصفقة جاهزة؛ لو التداول موقوف أو تهدئة اليوم قلها بسطر واحد وخلّ القرار للبوابة. لو قال إنه دخلها أو طلب يسجلها جهّز create_trade بالدخول والوقف والهدف الأول.
- النقاش: جاوب أسئلته عن نفس الشارت بجملة أو جملتين. لا تغيّر رأيك إلا بسبب حقيقي.
- أضف save_analysis لأول تحليل لكل شارت جديد.
${TRADE_BLOCK_RULE}
${ANALYST_SKILLS ? `\nخبرات المحلل:\n${ANALYST_SKILLS}` : ""}`;

const SHORT_RULE = `- أسلوب الرد إلزامي: مختصر وواضح ومباشر. بدون مقدمات ولا مجاملات ولا كلام زايد ولا تكرار. جمل قصيرة أو نقاط قليلة، وأقصى سؤال واحد بالآخر.`;

async function runAgent(sb: Sb, extra: string, input: Record<string, unknown>[], mode: AgentMode) {
  const [ctx, tz] = await Promise.all([buildContext(sb), userTz(sb)]);
  // The guide describes every action; a narrower mode is told which ones are its own.
  const tools = mode === "day" ? "" : `\nالإجراءات المتاحة لك هنا فقط: ${allowedActions(mode).map((t) => `${t} (${ACTION_LABEL[t]})`).join("، ")}. وغيرها قل له إنه ينسوّى من محادثة يومه مع سَنَد.`;
  // His wall clock, not the server's UTC: "الحين" and "الليلة" must mean his time.
  const out = await callAI(`${BASE_PERSONA}\n${AGENT_GUIDE}${tools}\n${extra}\n${SHORT_RULE}\n${PHONE_FORMAT}\n\n${ctx}\nالوقت الآن عند هادي: ${toWallInput(new Date(), tz).replace("T", " ")} (${tz})`, input, agentSchema(mode));
  const parsed = JSON.parse(out) as { reply?: string; actions?: unknown; suggestions?: unknown; step?: unknown };
  // Checked here too: the schema is only the model's promise, the server keeps what this mode may run.
  const { actions, dropped } = screenActions(parsed.actions, mode);
  if (dropped.length) console.warn("[agent] dropped actions outside", mode, dropped);
  const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, 3).map((x) => x.trim().slice(0, 40)) : [];
  return { reply: parsed.reply || "تم.", actions, suggestions, step: typeof parsed.step === "number" ? parsed.step : null };
}

export const coachReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid(), message: z.string().min(1).max(4000), image: z.string().startsWith("data:image/").max(8_000_000).optional(), thumb: z.string().startsWith("data:image/").max(MAX_THUMB_CHARS).optional(), retry: z.boolean().optional(), mode: z.enum(["coach", "risk", "strategy", "discipline", "analyst", "training"]).optional(), brief: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const sb = context.supabase;
      const stored = data.image ? `${data.message}${IMAGE_NOTE}` : data.message;
      let skip = false;
      if (data.retry) {
        const { data: newest } = await sb.from("coach_messages").select("id,role,content").eq("thread_id", data.threadId).order("created_at", { ascending: false }).limit(2);
        const decision = retryDecision(newest ?? [], stored);
        // Only the response was lost on the way back: hand back the saved reply, don't ask again.
        if (decision === "already-answered" && newest?.[0]) return { reply: newest[0].content, messageId: newest[0].id };
        skip = decision === "skip-insert";
      }
      if (!skip) {
        // Only a small preview is stored; the full image goes to the AI below.
        const { error: e1 } = await sb.from("coach_messages").insert({ user_id: context.userId, thread_id: data.threadId, role: "user", content: stored, image: data.thumb ?? null });
        if (e1) throw e1;
      }
      // The reply is produced in a task that outlives the request: if the phone drops
      // the connection, it still gets saved and the chat picks it up.
      const work = (async () => {
        // Newest rows, back in chronological order — long threads must still include the latest message.
        const { data: newestFirst } = await sb.from("coach_messages").select("role,content,actions").eq("thread_id", data.threadId).order("created_at", { ascending: false }).limit(HISTORY_LIMIT);
        const hist = (newestFirst ?? []).reverse();
        const input: Record<string, unknown>[] = toModelInput(hist, data.message, { image: data.image });
        let live = "";
        let chartThumb: string | null = null;
        if (data.mode === "analyst") {
          // Symbol comes from Hadi's own words only (never the greeting / AI replies).
          // With an uploaded image and no named symbol, his image decides — no guessed chart.
          let syms = detectSymbols(data.message);
          if (!syms.length && !data.image) {
            const users = hist.filter((m) => m.role === "user").slice(-4).reverse();
            for (const m of users) { const f = detectSymbols(m.content); if (f.length) { syms = f; break; } }
          }
          if (syms.length) {
            const { marketContext, chartImages } = await import("./market.server");
            const [ctxText, charts] = await Promise.all([marketContext(syms), chartImages(syms[0]!)]);
            live = ctxText;
            if (charts) {
              chartThumb = charts.thumb;
              const note = data.image ? "هذه شارتات حية رسمها النظام للتأكيد؛ صورة هادي هي الأساس." : "هذه شارتات حية رسمها النظام الآن من الشموع الحقيقية. اقرأ الهيكل والسيولة ومناطق العرض والطلب منها بعينك.";
              input.push({ role: "user", content: [{ type: "input_text", text: `${note}\n${charts.legend}` }, ...charts.images.map((u) => ({ type: "input_image", image_url: u, detail: "high" }))] });
            }
          }
        }
        const { reply, actions, suggestions } = await runAgent(sb, data.mode === "risk" ? RISK_MODE : data.mode === "strategy" ? STRATEGY_MODE : data.mode === "training" ? TRAINING_MODE : data.mode === "discipline" ? DISCIPLINE_MODE : data.mode === "analyst" ? ANALYST_MODE + (data.brief === false ? DETAILED_RULE : BRIEF_RULE) + live : "", input, agentModeFor(data.mode));
        const { data: saved, error: e2 } = await sb.from("coach_messages").insert({ user_id: context.userId, thread_id: data.threadId, role: "assistant", content: reply, actions: actions.length ? actions : null, image: chartThumb }).select("id").single();
        if (e2) throw e2;
        const update: { updated_at: string; title?: string } = { updated_at: new Date().toISOString() };
        if (hist.length <= 1) update.title = data.message.slice(0, 40);
        await sb.from("coach_threads").update(update).eq("id", data.threadId);
        return { reply, messageId: saved.id, suggestions };
      })();
      const { keepAlive } = await import("./request-context.server");
      keepAlive(work);
      return await work;
    } catch (e) { fail(e); }
  });

export const setupPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ text: z.string().min(1).max(8000) }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      return await runAgent(context.supabase, `المتداول جديد ويكتب لك وصف كامل لنظامه. حوّل كل ما ذكره إلى إجراءات: update_settings واحد يجمع كل الحدود والأهداف والرصيد والعملة، ثم add_strategy لكل استراتيجية، add_rule لكل قاعدة، وupdate_focus لأسواقه وهدفه ونقطة ضعفه. في reply لخّص ما فهمته واسأله عن أهم شيء ناقص (مثل حد الخسارة اليومي) إن لم يذكره.`, [{ role: "user", content: data.text }], "setup");
    } catch (e) { fail(e); }
  });

export const morningGreeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const sb = context.supabase;
      const day = dayKey(new Date(), await userTz(sb));
      const { data: existing } = await sb.from("notifications").select("id").eq("kind", "morning").eq("day", day).maybeSingle();
      if (existing) return { created: false };
      const ctx = await buildContext(sb, "brief");
      const body = await callAI(`${BASE_PERSONA}\n\n${ctx}`, [{ role: "user", content: `اكتب رسالة صباحية لهادي بسطرين فقط، بدون مقدمات: سطر صباح الخير وسطر وحدة فيه: هدفك اليوم وحد خسارتك ونصيحة ضد الطمع. ممنوع يزيد عن سطرين. اليوم ${day}.` }]);
      const { error } = await sb.from("notifications").insert({ user_id: context.userId, kind: "morning", day, title: "صباح الخير يا هادي ☀️", body });
      if (error && error.code !== "23505") throw error;
      return { created: true };
    } catch (e) { fail(e); }
  });

export const eveningReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const sb = context.supabase;
      const day = dayKey(new Date(), await userTz(sb));
      const { data: existing } = await sb.from("notifications").select("id").eq("kind", "evening").eq("day", day).maybeSingle();
      if (existing) return { created: false };
      const ctx = await buildContext(sb, "brief");
      const body = await callAI(`${BASE_PERSONA}\n\n${ctx}`, [{ role: "user", content: `اكتب مراجعة آخر اليوم لهادي بسطرين فقط بصفتك "حارس المخاطر": سطر يلخص ربح/خسارة اليوم والتزامه بحدوده، وسطر نصيحة واحدة لبكرة. ممنوع يزيد عن سطرين. اليوم ${day}.` }]);
      const { error } = await sb.from("notifications").insert({ user_id: context.userId, kind: "evening", day, title: "مراجعة اليوم 🌙", body });
      if (error && error.code !== "23505") throw error;
      return { created: true };
    } catch (e) { fail(e); }
  });

/** Risk guardian's opinion on a trade before entering it. */
export const riskAdvice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ trade: z.string().max(2000) }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const ctx = await buildContext(context.supabase, "brief");
      const text = await callAI(`${BASE_PERSONA}\n\n${ctx}`, [{ role: "user", content: `أنت "حارس المخاطر". قبل ما أدخل هذي الصفقة: ${data.trade}\nبثلاث نقاط قصيرة جداً: كم باقي لي من المخاطرة والخسارة اليوم، هل الصفقة تتعدى أي حد أو هدف (وطمع؟)، ثم الحكم بسطر: **ادخل** أو **خفّف الحجم** أو **لا تدخل** مع السبب.` }]);
      return { text };
    } catch (e) { fail(e); }
  });

export const performanceInsight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ period: z.string().max(40), stats: z.string().max(20000) }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const ctx = await buildContext(context.supabase, "brief");
      const text = await callAI(`${BASE_PERSONA}\n\n${ctx}`, [{ role: "user", content: `هذه أرقام أدائي الحقيقية لفترة "${data.period}": ${data.stats}\nاكتب ٣ نقاط قصيرة جداً (سطر لكل نقطة) كمحلل أداء خبير: وين أربح، وين أخسر، وشيء واحد أغيّره. استخدم الأرقام فقط ولا تخترع شيء. إذا البيانات قليلة قلها بصراحة.` }]);
      return { text };
    } catch (e) { fail(e); }
  });

export const reportSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ period: z.string().max(40), stats: z.string().max(20000) }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const ctx = await buildContext(context.supabase, "brief");
      const text = await callAI(
        `${BASE_PERSONA}\n\n${ctx}`,
        [
          {
            role: "user",
            content: `اكتب تقرير أداء وتحليل سلوك لفترة "${data.period}" بناءً على هذه الأرقام الحقيقية: ${data.stats}
التزم بالاختصار الشديد والعناوين التالية:
1. ملخص الأداء والانضباط (نظرة سريعة)
2. ما الذي تحسن في تداولك؟
3. ما السلوك الذي يسبب الخسارة أو استنزاف الرصيد؟
4. ما هي القاعدة التي تم خرقها أكثر شيء؟
5. إجراء واحد أو اثنان فقط محدد للأسبوع القادم لمنع تكرار الخطأ.`,
          },
        ]
      );
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
            strategy: { type: ["string", "null"] }, emotion: { type: ["string", "null"], enum: [...EMOTIONS, null] }, notes: { type: ["string", "null"] },
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
- الرمز من عنوان الشارت أعلى اليسار (مثل EURUSD أو XAUUSD أو GOLD) والفريم بجانبه.
- أداة Long/Short Position في TradingView (مستطيل أخضر/أزرق فوق مستطيل أحمر أو العكس): الدخول هو الحد الفاصل بين اللونين، الوقف هو طرف المنطقة الحمراء، والهدف هو طرف المنطقة الخضراء. المنطقة الخضراء فوق = long، تحت = short. اقرأ الأسعار من الملصقات أو من محور السعر يمين الشارت.
- خطوط الأوامر المفتوحة (Entry/SL/TP أو خطوط أفقية بملصقات سعر)، ونوافذ تأكيد الأمر، وسجل الصفقات في المنصات.
- إذا كانت الصورة شارت بدون صفقة مرسومة أو أرقام مقروءة، لا تخترع: أعد صفقة واحدة بما ظهر فعلاً (الرمز مثلاً) والباقي null، أو trades فارغة إذا لم يظهر شيء.` : "";
      const instructions = `استخرج الصفقات من كلام المتداول أو الصورة (لقطة منصة/شارت). لكل صفقة: action="open" لصفقة جديدة، أو "close" إذا يقول إنه أقفل صفقة. symbol بالإنجليزي بصيغة المنصات (الذهب=XAUUSD، الفضة=XAGUSD، ناسداك=US100، النفط=USOIL، داو جونز=US30، يورو دولار=EURUSD). direction long للشراء وshort للبيع. risk مبلغ المخاطرة بالعملة. strategy يجب أن يكون أحد هذه الأسماء بالضبط أو null: ${JSON.stringify((st.data ?? []).map((x) => x.name))}. emotion واحد من: ${EMOTIONS.join("، ")}، أو null. الصفقات المفتوحة حالياً: ${JSON.stringify(open.data ?? [])}. لا تخترع أرقام غير مذكورة — استخدم null. notes ملخص قصير بالعربي.${imageGuide}
message: جملة عربية قصيرة للمتداول: ماذا قرأت، وما الناقص (مثل: "قرأت الرمز XAUUSD، لكن ما فيه دخول أو وقف واضح. ارسم أداة Long Position أو اكتب الأرقام.").`;
      const content: Record<string, unknown>[] = [{ type: "input_text", text: data.text || "استخرج الصفقة من الصورة." }];
      if (data.image) content.push({ type: "input_image", image_url: data.image, detail: "high" });
      const out = await callAI(instructions, [{ role: "user", content }], TRADE_SCHEMA);
      return JSON.parse(out) as { message: string; trades: import("./ai-trade").AiTrade[] };
    } catch (e) { fail(e); }
  });

export const transcribeAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ audio: z.string().min(10).max(14_000_000), mime: z.string().startsWith("audio/").max(100) }).parse(d))
  .handler(async ({ data }) => {
    try {
      return { text: await transcribe(data.audio, data.mime) };
    } catch (e) { fail(e); }
  });

/** Once-a-day morning note from the risk guardian, written straight into its chat. */
export const riskMorning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid(), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const sb = context.supabase;
      const key = `risk-morning-${data.day}`;
      const { data: seen } = await sb.from("notifications").select("id").eq("dedupe_key", key).limit(1);
      if (seen?.length) return { skipped: true };
      const { error: lock } = await sb.from("notifications").insert({ user_id: context.userId, kind: "risk", day: data.day, title: "صباح الخير من حارس المخاطر", body: "رسالتك اليومية في صفحة إدارة المخاطر", dedupe_key: key, read: true, dismissed: true });
      if (lock) return { skipped: true };
      const { reply, actions } = await runAgent(sb, RISK_MODE, [{ role: "user", content: "اكتب لي رسالة صباحية قصيرة جدًا (٣ أسطر كحد أقصى): حالة حدودي اليوم، كم باقي لي مخاطرة وصفقات، أي تعارض بالإعدادات (وجهّز تصحيحه). ابدأ بـ صباح الخير هادي. ممنوع فقرات طويلة." }], "day");
      await sb.from("coach_messages").insert({ user_id: context.userId, thread_id: data.threadId, role: "assistant", content: reply, actions: actions.length ? actions : null });
      return { skipped: false };
    } catch (e) { fail(e); }
  });

export const disciplineMorning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid(), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const sb = context.supabase;
      const key = `discipline-morning-${data.day}`;
      const { data: seen } = await sb.from("notifications").select("id").eq("dedupe_key", key).limit(1);
      if (seen?.length) return { skipped: true };
      const { error: lock } = await sb.from("notifications").insert({ user_id: context.userId, kind: "reminder", day: data.day, title: "حارس الانضباط", body: "حدد خطتك اليوم في صفحة الانضباط", dedupe_key: key, read: true, dismissed: true });
      if (lock) return { skipped: true };
      const { reply, actions } = await runAgent(sb, DISCIPLINE_MODE, [{ role: "user", content: "ابدأ يومي: إذا ما عندي خطة اليوم اسألني عن هدفي وعدد صفقاتي وستوبي وأقصى خسارة. إذا عندي خطة ذكّرني فيها بسطرين كحد أقصى. ممنوع فقرات طويلة." }], "day");
      await sb.from("coach_messages").insert({ user_id: context.userId, thread_id: data.threadId, role: "assistant", content: reply, actions: actions.length ? actions : null });
      return { skipped: false };
    } catch (e) { fail(e); }
  });

const SCALP_FORMAT = {
  type: "json_schema", name: "scalp", strict: true,
  schema: { type: "object", additionalProperties: false, required: ["direction", "stop", "target", "reason"], properties: {
    direction: { type: "string", enum: ["long", "short"] }, stop: { type: "number" }, target: { type: "number" }, reason: { type: "string" },
  } },
};

/** Live price for the analyst's paper self-test. */
export const paperPrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ symbol: z.string().max(20) }).parse(d))
  .handler(async ({ data }) => {
    const s = detectSymbols(data.symbol)[0];
    if (!s) throw new Error("الزوج غير مدعوم.");
    const { livePrice } = await import("./market.server");
    const price = await livePrice(s);
    if (price == null) throw new Error("ما قدرت أجيب السعر الحي.");
    return { price, digits: s.digits };
  });

/** One virtual scalp idea (never a real trade) from the analyst's skills + live charts. */
export const paperIdea = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ symbol: z.string().max(20), history: z.string().max(3000).optional().default("") }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const s = detectSymbols(data.symbol)[0];
      if (!s) throw new Error("الزوج غير مدعوم.");
      const { marketContext, chartImages, livePrice } = await import("./market.server");
      const [ctx, live, charts, price] = await Promise.all([buildContext(context.supabase, "brief"), marketContext([s]), chartImages(s), livePrice(s)]);
      if (price == null) throw new Error("ما قدرت أجيب السعر الحي.");
      const content: Record<string, unknown>[] = [{ type: "input_text", text: `اختبار ذاتي تجريبي (صفقات وهمية، مو حقيقية). السعر الآن ${price.toFixed(s.digits)} على ${s.key}. أعطني صفقة سكالب واحدة تدخل الآن بسعر السوق، تنتهي خلال دقائق: وقف قريب (تقريبًا 0.5–1 ATR فريم 15M) وهدف 1.5–2 ضعف الوقف، مبنية على خبراتك واستراتيجية هادي. reason سطر واحد بالعربي.${data.history ? `\nصفقاتك السابقة في هذا الاختبار: ${data.history}` : ""}\n${charts?.legend ?? ""}` }, ...(charts?.images ?? []).map((u) => ({ type: "input_image", image_url: u, detail: "high" }))];
      const out = JSON.parse(await callAI(`${BASE_PERSONA}\n\n${ctx}\n\n${ANALYST_SKILLS}${live}`, [{ role: "user", content }], SCALP_FORMAT)) as { direction: "long" | "short"; stop: number; target: number; reason: string };
      return { ...out, entry: price, digits: s.digits, symbol: s.key };
    } catch (e) { fail(e); }
  });
