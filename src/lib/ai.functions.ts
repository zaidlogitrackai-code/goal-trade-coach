import { strategyStats } from "./perf";
import { planCheck } from "./daily-plan";
import { disciplineStreak } from "./streak";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AiError, BASE_PERSONA, callAI } from "./ai.server";
import { buildInsights, deriveSignals, FOCUS_CATEGORY, focusForPrompt, parseFocus } from "./focus";
import { buildJourney, journeyForPrompt } from "./journey";
import { CAPITAL_CATEGORY, capitalForPrompt, computeCapital, parseLedger } from "./capital";
import { GUARD_STYLE_CATEGORY, HIDDEN_NOTES } from "./hidden-notes";
import { ANALYST_SKILLS } from "./analyst-skills";
import { detectSymbols } from "./market-symbols";
import { computeDayMetrics, computeStatus, startOfToday } from "./trading-status";
import { IMAGE_NOTE, retryDecision } from "./chat-retry";
import { MAX_THUMB_CHARS } from "./image";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
type Sb = SupabaseClient<Database>;

async function buildContext(sb: Sb) {
  const [s, t, r, st, ex] = await Promise.all([
    sb.from("trading_settings").select("*").maybeSingle(),
    sb.from("trades").select("id,symbol,direction,status,entry_price,stop_loss,take_profit,pnl,risk_amount,emotion,checklist_passed,opened_at,closed_at,strategy_id").order("opened_at", { ascending: false }).limit(40),
    sb.from("trading_rules").select("title,description,active"),
    sb.from("strategies").select("id,name,description,entry_conditions,exit_conditions,allowed"),
    sb.from("strategy_examples").select("id,verdict,reason,symbol,timeframe,strategy_id").order("created_at", { ascending: false }).limit(40),
  ]);
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const dayStart = startOfToday().toISOString();
  const [notes, session, focusRow, month, todaySessions, todayViolations, capitalRow, closedAll] = await Promise.all([
    sb.from("knowledge_notes").select("title,category").not("category", "in", HIDDEN_NOTES).order("created_at", { ascending: false }).limit(50),
    sb.from("trading_sessions").select("started_at,plan,mood").is("ended_at", null).limit(1),
    sb.from("knowledge_notes").select("content").eq("category", FOCUS_CATEGORY).order("created_at").limit(1),
    sb.from("trades").select("symbol,status,pnl,emotion,strategy_id,stop_loss,risk_amount,opened_at,closed_at").gte("opened_at", since),
    sb.from("trading_sessions").select("ended_at").gte("started_at", dayStart).order("started_at", { ascending: false }).limit(1),
    sb.from("rule_violations").select("id").gte("occurred_at", dayStart),
    sb.from("knowledge_notes").select("content").eq("category", CAPITAL_CATEGORY).order("created_at").limit(1),
    sb.from("trades").select("status,pnl,opened_at,closed_at").eq("status", "closed"),
  ]);
  const [{ data: alerts }, { data: reminders }, { data: stSess }, { data: stViol }] = await Promise.all([
    sb.from("notifications").select("title,body,created_at").in("kind", ["risk", "reminder"]).order("created_at", { ascending: false }).limit(8),
    sb.from("reminders").select("title,repeat,at_time,next_at").eq("active", true).limit(20),
    sb.from("trading_sessions").select("started_at,ended_at,review").gte("started_at", new Date(Date.now() - 180 * 86_400_000).toISOString()),
    sb.from("rule_violations").select("occurred_at").gte("occurred_at", new Date(Date.now() - 180 * 86_400_000).toISOString()),
  ]);
  const { data: guardRow } = await sb.from("knowledge_notes").select("content").eq("category", GUARD_STYLE_CATEGORY).limit(1).maybeSingle();
  const guardStyle = guardRow?.content?.trim() || "";
  const todayKey = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const { data: plans } = await sb.from("daily_plans").select("day,target,max_trades,risk_per_trade,max_loss,note,revised_count").order("day", { ascending: false }).limit(7);
  const todayPlan = (plans ?? []).find((p) => p.day === todayKey) ?? null;
  const winDays = new Map<string, number>();
  for (const x of closedAll.data ?? []) { const k = (x.closed_at ?? x.opened_at).slice(0, 10); winDays.set(k, (winDays.get(k) ?? 0) + (Number(x.pnl) || 0)); }
  const wins = [...winDays.values()].filter((v) => v > 0);
  const planStatus = planCheck(todayPlan && { ...todayPlan, target: todayPlan.target == null ? null : Number(todayPlan.target), risk_per_trade: todayPlan.risk_per_trade == null ? null : Number(todayPlan.risk_per_trade), max_loss: todayPlan.max_loss == null ? null : Number(todayPlan.max_loss) }, (month.data ?? []).filter((x) => x.opened_at >= dayStart), s.data ?? {}, wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : null);
  const streak = disciplineStreak(stSess ?? [], stViol ?? [], s.data?.timezone || "Asia/Riyadh");
  const ledger = parseLedger(capitalRow.data?.[0]?.content);
  const capital = computeCapital({
    starting: Number(s.data?.starting_balance) || 0,
    since: s.data?.created_at ?? null,
    trades: closedAll.data ?? [],
    entries: ledger.entries,
  });
  const focus = parseFocus(focusRow.data?.[0]?.content);
  const cur = s.data?.currency ?? "USD";
  const monthTrades = month.data ?? [];
  const status = s.data ? computeStatus(s.data, computeDayMetrics(s.data, monthTrades, todayViolations.data?.length ?? 0)) : "ready";
  const latest = todaySessions.data?.[0];
  const journey = buildJourney({
    focusReady: focus.markets.length > 0 && !!(focus.goal || focus.weakness),
    strategies: st.data?.length ?? 0,
    rules: r.data?.length ?? 0,
    sessionToday: latest ? { active: !latest.ended_at, ended: !!latest.ended_at } : null,
    tradesToday: monthTrades.filter((x) => x.opened_at >= dayStart).length,
    blocked: status === "stopped" || status === "loss_limit" || status === "target_hit",
  });
  const insights = buildInsights(deriveSignals(month.data ?? [], st.data ?? [], focus), focus, (n) => `${Math.round(n * 100) / 100} ${cur}`);
  return `الأصول التي يغطيها النظام وتحللها دائماً بدون أي رفض أو اعتذار: XAUUSD (الذهب)، XAGUSD (الفضة)، US500، US100، US30 (يسمّى أيضاً US30USD)، EURUSD، GBPUSD، USDJPY، USOIL (نفط WTI)، وأي زوج عملات. إذا الصورة لواحد منها لا تقل أبداً "خارج نطاق النظام" أو "ما أحلل". العملات الرقمية والأسهم فقط خارج النظام؛ إذا طلبها قله بلطف.
ستريك الانضباط: ${streak.current} يوم سوق متتالي (أفضل ${streak.best}). يزيد لما يسكّر جلسته بمراجعة بدون مخالفة؛ السبت والأحد ما ينحسبون. لما يسكّر جلسة نظيفة هنّيه بالرقم الجديد، ولو قرّب يكسر قاعدة ذكّره إنه بيخسر الستريك.
${journeyForPrompt(journey)} إذا ما طلب شي ثاني، وجّهه لهذي الخطوة بجملة واحدة بآخر ردك.

${capitalForPrompt(capital, ledger.entries, s.data?.currency ?? "USD")}

طريقة حارس الانضباط اللي طلبها هادي: ${guardStyle || "لم يحددها بعد"}

ملف تركيز المتداول (اللي قاله عن نفسه، خلّ كل ردودك ونصايحك مربوطة فيه):
${focusForPrompt(focus)}
أنماط من صفقاته آخر 30 يوم: ${insights.length ? insights.map((i) => i.text).join(" ") : "لا يوجد بعد"}

بيانات المتداول (استخدمها فقط كسياق):
الإعدادات والحدود: ${JSON.stringify(s.data ?? {})}
القواعد: ${JSON.stringify(r.data ?? [])}
الاستراتيجيات: ${JSON.stringify(st.data ?? [])}
أمثلة تدريب هادي على استراتيجيته (good = دخول صحيح، bad = غلط) — طبّقها دايماً في الحكم على أي صفقة: ${JSON.stringify(ex.data ?? [])}
أداء كل استراتيجية (من آخر 30 يوم): ${JSON.stringify(strategyStats(month.data ?? [], st.data ?? []))}
خطة اليوم (اللي قالها هادي الصباح): ${JSON.stringify(todayPlan)}
فحص الخطة اليوم: ${JSON.stringify(planStatus)}
آخر 7 خطط: ${JSON.stringify(plans ?? [])}
الجلسة المفتوحة: ${JSON.stringify(session.data?.[0] ?? null)}
عناوين الملاحظات: ${JSON.stringify(notes.data ?? [])}
آخر تنبيهات حارس المخاطر (خذها بالاعتبار، وإذا فيها "وقف" لا تشجعه على صفقة جديدة): ${JSON.stringify(alerts ?? [])}
التذكيرات المفعّلة: ${JSON.stringify(reminders ?? [])}
آخر الصفقات (id للإشارة إليها): ${JSON.stringify(t.data ?? [])}`;
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
هذا الأصل ضمن نطاق النظام دائماً (الذهب والفضة والمؤشرات US500/US100/US30 والنفط USOIL والعملات) فحلّله بالكامل ولا ترفضه ولا تطلب شارتاً آخر. إذا الأصل غير مكتوب اقرأه من عنوان الشارت في الصورة. إن كانت الصورة قائمة أسعار (Watchlist) بدون شارت: اقرأ الأسعار وغيّر النسبة لكل أصل وأعطِ نظرة سريعة لكل أصل (صاعد/هابط/محايد) وأيها يستحق المتابعة (اكتب الجدول بصيغة Markdown صحيحة وكل صف في سطر مستقل)، ثم اطلب شارت الأصل الذي يريده للتفاصيل. وإلا رتّب الرد بهذه العناوين: الاتجاه العام، الدعوم والمقاومات، النماذج والإشارات، سيناريو شراء محتمل (دخول/وقف/هدف)، سيناريو بيع محتمل، مدى توافقه مع استراتيجياتي وقواعدي، نسبة المخاطرة للعائد، الخلاصة (ادخل/انتظر/تجنب) مع السبب.`;
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
            type: { type: "string", enum: ["update_settings", "add_strategy", "update_strategy", "delete_strategy", "add_rule", "update_rule", "delete_rule", "create_trade", "close_trade", "update_trade", "delete_trade", "add_note", "delete_note", "start_session", "end_session", "start_cooldown", "mark_notifications_read", "update_focus", "set_guard_style", "capital_move", "save_analysis", "delete_analysis", "delete_thread", "add_reminder", "delete_reminder", "set_daily_plan", "attach_trade_image", "remove_trade_image", "add_violation", "delete_violation", "delete_daily_plan", "update_session", "delete_session", "rename_thread", "delete_notifications", "add_strategy_example", "delete_strategy_example"] },
            summary: { type: "string" },
            data: { type: "string" },
          },
        },
      },
    },
  },
};

const AGENT_GUIDE = `أنت "سَنَد" — شريك هادي ضد الطمع ومساعده في كل شيء. تتكلم كشريك صادق مو كمدرب بعيد، وعبرك يُدار النظام كامل، وتقدر تنفّذ أي شيء في النظام نيابة عنه: المستخدم يقول، وأنت تجهّز الإجراءات، والنظام ينفّذها مباشرة.
مهمتك: تحلل صفقاته معه، تفكر معه، تنصحه، تمنعه من الطمع، وتلزمه بالهدف اليومي والأسبوعي والشهري وحدود الخسارة. إذا وصل لهدفه أو حد خسارته قل له يوقف بوضوح.
إذا ناقصك معلومة (استراتيجيته، حدوده، أهدافه) اسأله سؤال أو سؤالين واضحين.
عندما يطلب منك أو يذكر شيء يحتاج حفظ أو تعديل أو حذف، أضف إجراء في actions. النظام ينفّذ الإجراءات تلقائيًا، ما عدا الحذف وتخفيف حدود المخاطر وتحريك وقف الخسارة فتحتاج ضغطة موافقة. data نص JSON بهذه الأشكال:
- update_settings: {"starting_balance","daily_target","max_daily_profit","max_daily_loss","max_trades_per_day","max_risk_per_trade","max_daily_risk","max_consecutive_losses","weekly_target","weekly_max_loss","monthly_target","monthly_max_loss","cooldown_minutes","currency","display_name"} (أرسل فقط الحقول المذكورة، أرقام موجبة)
- add_strategy: {"name","description","entry_conditions","exit_conditions","markets","timeframes"}
- add_rule: {"title","description"}
- set_daily_plan: {"target","max_trades","risk_per_trade","max_loss","note"} — خطة هادي لليوم بأرقامه هو (أرسل المذكور فقط)
- create_trade: {"symbol" (مثل XAUUSD، أو null إذا ما ذكره),"direction":"long"|"short","entry_price","stop_loss","take_profit","position_size","risk_amount","strategy" (اسم استراتيجية موجودة أو null),"emotion","notes","status":"open"|"closed","pnl" (للصفقة المنتهية، سالب للخسارة),"exit_price","opened_at" (وقت الفتح ISO إذا ظهر بالصورة)} — نفس الصفقة لو انرفعت مرتين النظام ما يكررها، ولو صارت مقفولة يقفلها.
- save_analysis: {"symbol","timeframe","question","result" (تحليلك للشارت markdown)} — احفظ أي تحليل شارت تسويه
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
- delete_notifications: {} (يمسح كل التنبيهات)
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
- capital_move: {"kind" ("deposit" إيداع | "withdrawal" سحب | "set_balance" رصيده الحقيقي الآن),"amount","note"} — لما يحكي إنه أودع أو سحب أو إن رصيده صار كذا. أرباح وخسائر الصفقات المغلقة تنحسب على الرصيد تلقائيًا، فلا تسجلها هنا. لتصحيح الرصيد الحالي استخدم set_balance مش starting_balance. بعد سحب كبير اقترح تخفيض حدود المخاطرة لتناسب الرصيد الجديد.
ملف التركيز هو اللي يبني النظام حوله: الداشبورد والقائمة وصفحة الصفقة كلها تقرأ منه.
- لما يحكي شيء ثابت عن نفسه (سوقه، أسلوبه، هدفه، نقطة ضعفه، شيء بيتكرر معه)، أضف update_focus بنفس الرد. لا تحفظ مزاج اللحظة أو تفاصيل صفقة وحدة.
- إذا الملف فاضي أو ناقص (ما في سوق أو هدف أو نقطة ضعف)، اسأله سؤال واحد عنها بآخر ردك.
- ارجع لنقطة ضعفه وقاعدته لما يكون الكلام متعلق فيها، ونبهه إذا طلب صفقة برّا أسواقه (صفقة برّا سوقه تحتاج موافقته).
- إذا الأنماط تكشف ضعف مش مكتوب بالملف (مثل خسارة بعد الخسارة)، قله واقترح تحديث الملف.
مقابلة الطمع والأهداف: إذا أي واحد من هذول صفر أو ناقص (الهدف اليومي daily_target، الأسبوعي weekly_target، الشهري monthly_target، حد الخسارة اليومي max_daily_loss، أقصى مخاطرة للصفقة max_risk_per_trade، سقف الربح اليومي max_daily_profit)، أو طلب "اسألني عن أهدافي": حقق معه مثل مدرب صارم ولطيف — اسأل سؤالين بالكثير بكل رد بالترتيب: كم رصيدك؟ كم تارقتك (هدفك) باليوم وبالأسبوع وبالشهر؟ كم أقصى خسارة تقبلها باليوم؟ كم تخاطر بالصفقة؟ وش تسوي لما توصل هدفك — توقف ولا تكمل؟ ومتى طمعت قبل وش صار؟ كل جواب يعطيه احفظه فوراً بـ update_settings (سقف الربح اليومي = هدفه اليومي إلا إذا قال غير كذا)، ونقطة ضعفه بـ update_focus. إذا الهدف مبالغ فيه مقارنة برصيده (أكثر من 3% باليوم) قل له بصراحة إنه طمع واقترح رقم أصغر. لما تكتمل قل له ملخص أهدافه وإن النظام بيوقفه عندها.
قواعد مهمة جداً:
1. التنفيذ يتم بعد ردك، فلا تقل "تم" أو "سجلتها". قل "جهزت التنفيذ" أو "بنفذها لك الحين"، والنتيجة تظهر تحت ردك.
1.1. لا تحذف شيئًا إلا إذا طلب المستخدم الحذف صراحة. لا تخفف حدود المخاطر لتسمح له بالتداول بعد ما وصل حده؛ ذكّره بالحد بدلًا من ذلك.
1.2. إذا كان في تهدئة أو تجاوز حدًا، لا تجهز صفقة جديدة. بوابة التداول ترفض الصفقات المخالفة على أي حال.
2. إذا طلب تسجيل صفقة (بنص أو صورة)، لازم تضيف create_trade في نفس الرد بالمعلومات المتوفرة حتى لو ناقص الرمز أو الاتجاه (حط null أو long). الصفقة المنتهية بربح أو خسارة: status "closed" مع pnl. لا تستبدل الصفقة بملاحظة add_note.
3. إذا قال "سجلها" أو "نفذ" لشيء ذكرتموه قبل، جهّز الإجراء الآن من المحادثة السابقة بدون ما تعيد الأسئلة.
4. لقطة MetaTrader 5 (تبويب التداول Trade أو السجل History، جوال أو كمبيوتر): كل سطر صفقة = create_trade منفصل. buy=long، sell=short. الحجم lots في position_size، سعر الفتح entry_price، S/L وT/P، السعر الحالي/الإغلاق exit_price، الربح Profit في pnl. تبويب Trade = صفقات مفتوحة (status open، بدون pnl)؛ History = منتهية (status closed مع pnl). لا تسأل "تبيني أسجلها؟" — سجلها مباشرة، ونبهه إذا تجاوزت حدوده أو هدفه (لا تطمع).
4.1. صورة شارت بدون صفقات: حلله (الاتجاه، الدعوم والمقاومات، سيناريو دخول ووقف وهدف) وأضف save_analysis.
4.2. اقرأ الصور المرفقة بعناية واستخرج منها كل الصفقات (الرمز، الاتجاه، الدخول، الخروج، الربح).
5. جلسة التداول (أنت منظمها بالكامل، ما في نماذج يدوية): إذا ما في جلسة مفتوحة وقال إنه بيتداول اليوم، اسأله باختصار (سؤالين بالكثير بكل رد): وش تارقتك اليوم؟ أي أسواق بتراقب؟ كم صفقة بالكثير؟ شي واحد ممنوع اليوم؟ وكيف نفسيتك؟ أول ما يعطيك التارقت والسوق ابدأ الجلسة بـ start_session (plan فيه الأصول والتارقت وأقصى صفقات والممنوع والخطة، mood بكلمة وحدة) وحدّث daily_target بـ update_settings إذا تغيّر. إذا التارقت طمع قل له. إذا قال ما بيتداول اليوم احترم قراره وما تبدأ جلسة. إذا في جلسة مفتوحة وقال "خلصت" أو "سكّر الجلسة": اسأله بسؤال واحد عن التزامه بالخطة وهل طمع أو انتقم وأفضل وأسوأ قرار، وبعد جوابه أضف end_session مع review مرتب. لو قال سكّرها بدون مراجعة سكّرها بمراجعة مختصرة من صفقات الجلسة.
لا تخترع أرقام ما قالها ولا ظهرت بالصورة. summary جملة عربية قصيرة تشرح الإجراء. reply ردك بالعربي بصيغة markdown مختصر. إذا ما فيه شي يُحفظ خل actions فاضية.`;

const RISK_MODE = `وضعك الحين: أنت "حارس المخاطر" لهادي. ركّز على حدوده (الهدف وسقف الربح وحد الخسارة اليومي والأسبوعي والشهري، المخاطرة لكل صفقة واليومية، عدد الصفقات، الخسائر المتتالية) وتنبيهات المراقب الأخيرة.
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
- بطاقة الصفقة إلزامية: في آخر reply لكل تحليل أو اقتراح صفقة اكتب بلوك بهذا الشكل بالضبط (أرقام من الشارت فقط):
\`\`\`trade
{"direction":"buy|sell|none","entry_from":0,"entry_to":0,"sl":0,"tp1":0,"tp2":0,"confidence":"عالية|متوسطة|ضعيفة","skills":["SMC","POC"],"no_trade_reason":null}
\`\`\`
  شراء: sl تحت الدخول وtp1<tp2 فوقه. بيع: العكس. لا صفقة: direction "none" مع no_trade_reason. skills = الخبرات اللي اتفقت (اثنتين على الأقل وإلا none). في ردود النقاش بدون صفقة جديدة لا تكتب البلوك.`;
const BRIEF_RULE = `
- الوضع المختصر: لا تتفلسف. بدون عناوين القالب. سطر واحد ليش (الخبرات اللي اتفقت)، وسطر واحد وش يلغي الفكرة، ثم البطاقة. لا تكرر الأرقام في النص.`;
const DETAILED_RULE = `
- الوضع المفصّل: اشرح أقسام القالب كاملة باختصار ثم البطاقة.`;

const ANALYST_MODE = `وضعك الحين: أنت "المحلل الذكي" لهادي، محلل فني محترف تتناقش معه على الشارتات.
- تحلل دايماً هذي الأصول: XAUUSD (الذهب)، XAGUSD (الفضة)، US500، US100، US30، EURUSD، GBPUSD، USDJPY، USOIL (النفط). لا تقول "خارج النطاق" لأي واحد منها. الكريبتو والأسهم الفردية ارفضها بلطف.
- أول تحليل للصورة (أو أي طلب "رأيك أدخل/أعطني صفقة"): التزم بهذا القالب بالترتيب وبعناوين قصيرة:
  1. **الصورة الكبيرة:** الأصل والفريم، واتجاه الفريم الأكبر (قمم/قيعان)، وين السعر الحين.
  2. **قراءة الأموال الذكية (SMC):** السيولة القريبة (قمم/قيعان متساوية)، كسر هيكل أو تغيّر اتجاه، منطقة أوامر البنوك، فجوة السعر، وهل السعر في منطقة غلاء أو رخص. كل بند بسعر أو نطاق من الشارت.
  2ب. **مناطق الحجم وPOC:** نقطة التحكم POC ومنطقة القيمة VAH/VAL وعقد الحجم HVN/LVN من الشارت أو مؤشر الحجم (Volume Profile). هل السعر داخل منطقة القيمة (ارتداد نحو POC) أو برّاها (اختراق)؟ طبّق قائمة فحص POC Bounce.
  2ج. **قراءة الحجم:** هل الحجم يأكد الحركة أو فيه تباعد/امتصاص، ومرحلة وايكوف لو واضحة (Spring/Upthrust). لو الحجم ما يبين في الصورة قل كذا بصراحة وخفّض الثقة.
  3. **الصفقة:** شراء/بيع — الدخول (رقم + نوعه حدّي أو عند الاختراق) — الوقف (رقم + ليش هناك: خلف سيولة/منطقة) — الهدف 1 والهدف 2 والهدف 3 (رقم + ليش كل واحد) — العائد للمخاطرة لكل هدف. لو أقل من 1:2 قل "ما تستاهل".
  4. **التأكيد والإلغاء:** متى بالضبط تدخل (شمعة إغلاق/ارتداد)، وأي سعر يلغي الفكرة.
  5. **السيناريو المعاكس** ودرجة الثقة (عالية/متوسطة/ضعيفة) وليش.
  6. **اللوت:** احسب اللوت اللي يخلي الخسارة داخل حد المخاطرة للصفقة. حجم العقد بالأونصة/الوحدة للّوت الواحد: الذهب 100، الفضة 5000، النفط 1000، المؤشرات 1، العملات 100000 (الين: قسّم على سعر الدخول). الخسارة = مسافة الوقف × اللوت × حجم العقد.
- استخدم الخبرات الأربع (trader، SMC، POC Bounce، Volume Analysis) في كل تحليل. لا تعطي دخول إلا إذا توافقت خبرتين على الأقل على نفس المنطقة (مثلاً منطقة بنوك + POC)، واذكر أي خبرات توافقت.
- كل الأسعار تنقرأ من الشارت المرفوع فقط. لو الأرقام ما تبين اطلب فريم أوضح ولا تخترع. لو ما فيه إعداد واضح قل "لا صفقة الحين، انتظر" وحدد وش تنتظر بسعر.
- تأكد قبل الرد: وقف الشراء تحت الدخول ووقف البيع فوقه، والأهداف بالاتجاه الصحيح. لو الصفقة صالحة وحدودها تسمح، جهّز create_trade بالدخول والوقف والهدف الأول واللوت (بدون risk_amount إلا لو حسبته صح)، واذكر إن الصفقة تمر على حارس المخاطر.
- قارن الإعداد بأمثلة تدريب هادي (good/bad) وقل يشبه أي مثال، ثم باستراتيجياته وقواعده المكتوبة وقل بصراحة يطابق أو لا وأي شرط ناقص. احسب مخاطرة الوقف مقابل حدوده ونبهه لو فيه طمع.
- النقاش: جاوب على أسئلته عن نفس الشارت من التحليل السابق في المحادثة. إذا عارضك ناقشه بالمنطق، وما تغيّر رأيك إلا إذا جاب سبب حقيقي، وقل له إذا غيّرته وليش.
- ما تخترع أسعار ما تبين في الصورة. إذا الصورة ما تكفي اطلب فريم أوضح. أضف save_analysis لأول تحليل لكل شارت جديد. القرار النهائي له.
${TRADE_BLOCK_RULE}
${ANALYST_SKILLS ? `\nخبرات المحلل:\n${ANALYST_SKILLS}` : ""}`;

async function runAgent(sb: Sb, extra: string, input: Record<string, unknown>[]) {
  const ctx = await buildContext(sb);
  const out = await callAI(`${BASE_PERSONA}\n${AGENT_GUIDE}\n${extra}\n\n${ctx}\nالتاريخ الآن: ${new Date().toISOString()}`, input, AGENT_SCHEMA);
  const parsed = JSON.parse(out) as { reply: string; actions: { type: string; summary: string; data: string }[] };
  return { reply: parsed.reply || "تم.", actions: (parsed.actions ?? []).slice(0, 30) };
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
        const { data: hist } = await sb.from("coach_messages").select("role,content").eq("thread_id", data.threadId).order("created_at").limit(40);
        const input: Record<string, unknown>[] = (hist ?? []).map((m) => ({ role: m.role, content: m.content }));
        if (data.image) input.push({ role: "user", content: [{ type: "input_text", text: data.message }, { type: "input_image", image_url: data.image, detail: "high" }] });
        let live = "";
        if (data.mode === "analyst") {
          const recent = [data.message, ...(hist ?? []).slice(-4).map((m) => m.content)].join(" ");
          const syms = detectSymbols(data.message).length ? detectSymbols(data.message) : detectSymbols(recent);
          if (syms.length) { const { marketContext } = await import("./market.server"); live = await marketContext(syms); }
        }
        const { reply, actions } = await runAgent(sb, data.mode === "risk" ? RISK_MODE : data.mode === "strategy" ? STRATEGY_MODE : data.mode === "training" ? TRAINING_MODE : data.mode === "discipline" ? DISCIPLINE_MODE : data.mode === "analyst" ? ANALYST_MODE + (data.brief === false ? DETAILED_RULE : BRIEF_RULE) + live : "", input);
        const { data: saved, error: e2 } = await sb.from("coach_messages").insert({ user_id: context.userId, thread_id: data.threadId, role: "assistant", content: reply, actions: actions.length ? actions : null }).select("id").single();
        if (e2) throw e2;
        const update: { updated_at: string; title?: string } = { updated_at: new Date().toISOString() };
        if ((hist ?? []).length <= 1) update.title = data.message.slice(0, 40);
        await sb.from("coach_threads").update(update).eq("id", data.threadId);
        return { reply, messageId: saved.id };
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
      const day = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
      const { data: existing } = await sb.from("notifications").select("id").eq("kind", "evening").eq("day", day).maybeSingle();
      if (existing) return { created: false };
      const ctx = await buildContext(sb);
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
      const ctx = await buildContext(context.supabase);
      const text = await callAI(`${BASE_PERSONA}\n\n${ctx}`, [{ role: "user", content: `أنت "حارس المخاطر". قبل ما أدخل هذي الصفقة: ${data.trade}\nبثلاث نقاط قصيرة جداً: كم باقي لي من المخاطرة والخسارة اليوم، هل الصفقة تتعدى أي حد أو هدف (وطمع؟)، ثم الحكم بسطر: **ادخل** أو **خفّف الحجم** أو **لا تدخل** مع السبب.` }]);
      return { text };
    } catch (e) { fail(e); }
  });

export const performanceInsight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ period: z.string().max(40), stats: z.string().max(20000) }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const ctx = await buildContext(context.supabase);
      const text = await callAI(`${BASE_PERSONA}\n\n${ctx}`, [{ role: "user", content: `هذه أرقام أدائي الحقيقية لفترة "${data.period}": ${data.stats}\nاكتب ٣ نقاط قصيرة جداً (سطر لكل نقطة) كمحلل أداء خبير: وين أربح، وين أخسر، وشيء واحد أغيّره. استخدم الأرقام فقط ولا تخترع شيء. إذا البيانات قليلة قلها بصراحة.` }]);
      return { text };
    } catch (e) { fail(e); }
  });

export const reportSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ period: z.string().max(40), stats: z.string().max(20000) }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const ctx = await buildContext(context.supabase);
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
- الرمز من عنوان الشارت أعلى اليسار (مثل EURUSD أو XAUUSD أو GOLD) والفريم بجانبه.
- أداة Long/Short Position في TradingView (مستطيل أخضر/أزرق فوق مستطيل أحمر أو العكس): الدخول هو الحد الفاصل بين اللونين، الوقف هو طرف المنطقة الحمراء، والهدف هو طرف المنطقة الخضراء. المنطقة الخضراء فوق = long، تحت = short. اقرأ الأسعار من الملصقات أو من محور السعر يمين الشارت.
- خطوط الأوامر المفتوحة (Entry/SL/TP أو خطوط أفقية بملصقات سعر)، ونوافذ تأكيد الأمر، وسجل الصفقات في المنصات.
- إذا كانت الصورة شارت بدون صفقة مرسومة أو أرقام مقروءة، لا تخترع: أعد صفقة واحدة بما ظهر فعلاً (الرمز مثلاً) والباقي null، أو trades فارغة إذا لم يظهر شيء.` : "";
      const instructions = `استخرج الصفقات من كلام المتداول أو الصورة (لقطة منصة/شارت). لكل صفقة: action="open" لصفقة جديدة، أو "close" إذا يقول إنه أقفل صفقة. symbol بالإنجليزي بصيغة المنصات (الذهب=XAUUSD، الفضة=XAGUSD، ناسداك=US100، النفط=USOIL، داو جونز=US30، يورو دولار=EURUSD). direction long للشراء وshort للبيع. risk مبلغ المخاطرة بالعملة. strategy يجب أن يكون أحد هذه الأسماء بالضبط أو null: ${JSON.stringify((st.data ?? []).map((x) => x.name))}. emotion واحد من: هادئ، واثق، متوتر، متحمس، خائف، غاضب، طمع، أو null. الصفقات المفتوحة حالياً: ${JSON.stringify(open.data ?? [])}. لا تخترع أرقام غير مذكورة — استخدم null. notes ملخص قصير بالعربي.${imageGuide}
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
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("خدمة الذكاء غير مهيأة.");
    const bin = Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0));
    const mime = data.mime.split(";")[0]!;
    const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : mime.includes("wav") ? "wav" : "webm";
    const form = new FormData();
    form.append("model", "openai/gpt-transcribe");
    form.append("file", new File([bin], `voice.${ext}`, { type: mime }));
    form.append("response_format", "json");
    form.append("language", "ar");
    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
    if (!res.ok) {
      console.error("transcribe error", res.status, (await res.text().catch(() => "")).slice(0, 300));
      if (res.status === 402 || res.status === 403) throw new Error("رصيد الذكاء الاصطناعي انتهى أو غير مفعّل.");
      throw new Error("ما قدرت أفهم الرسالة الصوتية، جرّب مرة ثانية.");
    }
    const j = (await res.json()) as { text?: string };
    const text = (j.text ?? "").trim();
    if (!text) throw new Error("ما سمعت شي بالتسجيل.");
    return { text };
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
      const { error: lock } = await sb.from("notifications").insert({ user_id: context.userId, kind: "risk", day: data.day, title: "صباح الخير من حارس المخاطر", body: "رسالتك اليومية في صفحة إدارة المخاطر", dedupe_key: key, read: true } as never);
      if (lock) return { skipped: true };
      const { reply, actions } = await runAgent(sb, RISK_MODE, [{ role: "user", content: "اكتب لي رسالة صباحية قصيرة جدًا (٣ أسطر كحد أقصى): حالة حدودي اليوم، كم باقي لي مخاطرة وصفقات، أي تعارض بالإعدادات (وجهّز تصحيحه). ابدأ بـ صباح الخير هادي. ممنوع فقرات طويلة." }]);
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
      const { error: lock } = await sb.from("notifications").insert({ user_id: context.userId, kind: "reminder", day: data.day, title: "حارس الانضباط", body: "حدد خطتك اليوم في صفحة الانضباط", dedupe_key: key, read: true } as never);
      if (lock) return { skipped: true };
      const { reply, actions } = await runAgent(sb, DISCIPLINE_MODE, [{ role: "user", content: "ابدأ يومي: إذا ما عندي خطة اليوم اسألني عن هدفي وعدد صفقاتي وستوبي وأقصى خسارة. إذا عندي خطة ذكّرني فيها بسطرين كحد أقصى. ممنوع فقرات طويلة." }]);
      await sb.from("coach_messages").insert({ user_id: context.userId, thread_id: data.threadId, role: "assistant", content: reply, actions: actions.length ? actions : null });
      return { skipped: false };
    } catch (e) { fail(e); }
  });
