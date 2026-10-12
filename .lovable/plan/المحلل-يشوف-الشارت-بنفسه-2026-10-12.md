# المحلل يشوف الشارت بنفسه

اليوم المحلل يقرأ أرقام السوق (السعر وملخص الشموع) بس، وما يشوف صورة الشارت. الخطة إنه يرسم الشارت بنفسه ويشوفه بعينه قبل ما يحلل.

## اللي بيصير
- لما تسأل «حلّل الذهب» بدون صورة، المحلل يرسم شارت حقيقي للزوج من الشموع المباشرة: 4H و1H و15M.
- يرسل صور الشارت للذكاء الاصطناعي مع الأرقام، فيقرأ الهيكل والسيولة ومناطق العرض والطلب بالعين، وبعدها يعطيك صفقة شراء أو بيع.
- تحت رده تطلع صورة صغيرة للشارت اللي شافه. تضغطها وتكبر، فتتأكد إنه شاف نفس اللي تشوفه.
- مجاني بالكامل، ونفس مصادر الأسعار الحالية.
- لو رفعت صورتك أنت، يعتمد صورتك أول شي، ويستخدم شارته للتأكيد.

## الفحص
- أسأله عن الذهب والناسداك واليورو وأتأكد إن الصورة تطلع وإن الأسعار عليها تطابق السعر الحالي.

## Technical details
- New pure `src/lib/chart-render.ts`: candles -> SVG string (candles, last price line, high/low labels).
- Server: in analyst path of `src/lib/ai.functions.ts`, build SVGs from `market.server.ts` candles (export a `chartCandles(sym)` helper), convert SVG to PNG via `@resvg/resvg-wasm` (Worker-compatible), and attach as image parts to the vision model call.
- Return a small thumbnail with the reply; store in `coach_messages.image` for the assistant message.
- Test: chart-render scaling (highest high at top, lowest low at bottom).
