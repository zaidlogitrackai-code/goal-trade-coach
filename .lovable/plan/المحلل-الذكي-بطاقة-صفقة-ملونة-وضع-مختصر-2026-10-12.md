# المحلل الذكي: بطاقة صفقة ملونة + وضع مختصر

## وش بيتغيّر
1. **بطاقة صفقة واضحة تحت كل تحليل:** يطلع فيها الاتجاه (شراء أخضر / بيع أحمر)، ومنطقة الدخول، و**TP1 وTP2 بالأخضر**، و**SL بالأحمر**، ونسبة العائد للمخاطرة، ودرجة الثقة، والخبرات اللي اتفقت (مثل SMC + POC). لو المحلل شاف إنه ما فيه صفقة، تطلع بطاقة رمادية مكتوب فيها "لا صفقة — انتظر" مع السبب.
2. **فحص الأرقام قبل ما تطلع البطاقة:** في الشراء لازم يكون الوقف تحت الدخول والأهداف فوقه، وفي البيع العكس. ولازم TP2 يكون أبعد من TP1. لو الأرقام غلط، البطاقة ما تطلع وتجيك ملاحظة "الأرقام متناقضة، اطلب تحليل جديد".
3. **زر "مختصر / مفصّل" فوق المحادثة:**
   - **مختصر** (يشتغل من البداية): البطاقة وسطرين بس عن السبب ووش يلغي الفكرة.
   - **مفصّل**: يشرح كل الأقسام زي ما يسوي الحين (الصورة الكبيرة، SMC، الحجم، السيناريو المعاكس، اللوت).
   - التطبيق يتذكر اختيارك.
4. **الخبرات الأربع** (التاجر، الأموال الذكية SMC، ارتداد نقطة التحكم POC، تحليل الحجم) تبقى شغالة في كل تحليل. وما يعطيك صفقة إلا لو اتفقت خبرتين منها على نفس المنطقة.

## التجربة بعد التنفيذ
أرفع شارت للمحلل في الوضعين (المختصر والمفصّل) وأتأكد من ثلاثة أشياء: البطاقة تطلع بألوانها، الأرقام منطقية، والوضع المختصر فعلاً قصير. وأحذف محادثة التجربة بعدها.

## Technical details
- `ANALYST_MODE` (src/lib/ai.functions.ts): require a fenced ```trade JSON block {direction, entry_from, entry_to, sl, tp1, tp2, rr, confidence, skills[], no_trade_reason} at the end of every analysis; add `brief` flag to coachReply input (mode=analyst) appending a SHORT rule (card + ≤2 lines).
- New pure `src/lib/trade-card.ts`: parse + validate block (direction/SL/TP ordering, rr computed) with vitest tests.
- New `src/components/trade-card.tsx`: colored card using success/destructive tokens; md.tsx/session-agent renders the block via the card instead of raw code.
- `analyst.tsx`: brief/detailed toggle (localStorage `analyst-brief`), passed through SessionAgent to coachReply.
