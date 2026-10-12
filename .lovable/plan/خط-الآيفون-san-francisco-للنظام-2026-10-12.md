# خط الآيفون (San Francisco) للنظام

## الوضع الحالي
الموقع يستخدم IBM Plex Sans Arabic للنص، Readex Pro للعناوين، Space Grotesk للأرقام — كلها تتحمّل من الإنترنت وما تشبه خط الآيفون.

## ملاحظة مهمة
خط آبل (SF Pro و SF Arabic) ما تسمح آبل بتنزيله ورفعه داخل المواقع (ترخيصه للأجهزة والتطبيقات فقط). لكن الحل الأفضل أصلا: نخلي الموقع يطلب "خط النظام"، فالآيفون يعرضه بخطه الحقيقي (SF للإنجليزي والأرقام + SF Arabic للعربي) بدون تحميل أي ملف، وبشكل أسرع وأوضح.
وللأجهزة غير آبل (كمبيوتر ويندوز مثلا) نحط خط بديل قريب جدا: Inter للإنجليزي والأرقام، مع IBM Plex Sans Arabic للعربي.

## التغييرات
1. `src/styles.css`: 
   - `--font-sans` و `--font-display` و `--font-data` تصير: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "SF Arabic", "Inter", "IBM Plex Sans Arabic", system-ui, sans-serif`.
   - الأرقام (font-data) تبقى بأرقام متساوية العرض (tabular-nums) بخط SF Mono-like: `ui-monospace, "SF Mono"` غير مطلوب؛ نستخدم SF مع tabular-nums عشان تبقى الأرقام نظيفة مثل تطبيقات آبل.
   - العناوين: وزن 600 وتباعد حروف خفيف سالب (-0.01em) مثل أسلوب iOS.
   - إضافة `-webkit-font-smoothing: antialiased` و `text-rendering: optimizeLegibility`.
2. `src/routes/__root.tsx`: استبدال رابط Google Fonts (Readex Pro و Space Grotesk) برابط Inter + IBM Plex Sans Arabic فقط (احتياطي لغير الآيفون).
3. فحص بصري على الجوال والكمبيوتر (الوضعين) والتأكد من عدم تغيّر التصميم ولا ظهور أخطاء.

## ما لن يتغير
التصميم الزجاجي، الألوان، الترتيب — الخط فقط.

## ملاحظة للاختبار
خط SF الحقيقي يظهر فقط على أجهزة آبل؛ هنا في المعاينة أتحقق من الاحتياطي، وأنت تتأكد من جوالك بعد النشر.
