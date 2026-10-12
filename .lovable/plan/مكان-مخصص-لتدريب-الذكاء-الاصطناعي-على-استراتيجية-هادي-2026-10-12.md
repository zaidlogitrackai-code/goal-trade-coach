# مكان مخصص لتدريب الذكاء الاصطناعي على استراتيجية هادي

## الفكرة
صفحة جديدة اسمها **«تدريب الذكاء»** تكون مثل "مدرسة" للوكيل: هادي يعلّمه استراتيجيته خطوة بخطوة، والوكيل يحفظ ما تعلّمه، وبعدها كل الوكلاء (المحلل، سَنَد، حارس المخاطر) يحللون على طريقة هادي بالضبط.

## وش فيها
1. **محادثة التدريب** — الوكيل يسأل هادي أسئلة منظمة: شروط الدخول، الوقف، الأهداف، الفريمات، الأوقات، الأزواج، ومتى ما يدخل.
2. **أمثلة بالصور** — هادي يرفع شارت ويقول «هذا دخول صحيح» أو «هذا غلط»، مع سبب قصير. الوكيل يحفظه كمثال.
3. **ملف الاستراتيجية المتعلَّم** — لوحة صغيرة فوق تعرض ما فهمه الوكيل (القواعد + عدد الأمثلة + نسبة اكتمال التدريب). أي تعديل يقترحه الوكيل يحتاج موافقة هادي.
4. **اختبار** — زر «اختبرني»: الوكيل يعرض مثال سابق ويسأل هادي يدخل أو لا، أو العكس: هادي يرفع شارت والوكيل يحكم عليه حسب ما تعلّم، وهادي يصححه.
5. **الربط** — المحلل الذكي يقرأ ملف الاستراتيجية والأمثلة قبل أي تحليل، ويقول صراحة إذا الصفقة تطابق استراتيجية هادي أو لا.

## مكانها
- في قائمة «المزيد» بالجوال وفي القائمة الجانبية بالكمبيوتر.
- صفحة الاستراتيجيات الحالية تبقى كما هي.

## Technical details
- New route `src/routes/_authenticated/training.tsx` using `SessionAgent` with new mode `training` (dedicated thread «تدريب الذكاء», hidden from coach list).
- New table `strategy_examples` (user_id, strategy_id nullable, verdict good/bad, reason, thumbnail, symbol, timeframe, created_at) with owner-only RLS + grants.
- New agent actions `add_strategy_example` / `update_strategy_rules` (zod-validated, approval flow as existing).
- `TRAINING_MODE` prompt in `ai.functions.ts`; `buildContext` adds a compact summary of examples (latest N, text only) so analyst/coach use them.
- Pure helper `src/lib/training.ts` for completeness score, with tests.
- Add nav entry in `app-shell.tsx`; update AGENTS.md.
