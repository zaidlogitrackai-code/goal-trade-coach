# Ready-made prompts for Claude (copy and paste)

> Open Claude Code in the project folder (`D:\هادي العجمي` or `C:\Users\zero\goal-trade-coach`). Claude reads `CLAUDE.md` on its own, then the context file.
> Pick the prompt that fits, copy it, and fill in whatever is between < >.

---

## 1) Continue the plan (the most common)
```
كمّل الخطة. استخدم سكل continue-plan: خذ أول مهمة باقية من docs/CONTEXT.md، نفّذ الجوهر بس، افحص وارفع على main، وحدّث قسم الحالة. مهمة وحدة بس، وبعدها قلّي شو تغيّر على الآيفون.
```

## 2) A specific task
```
نفّذ المهمة <T14> من docs/plan-sanad-steps.md. استخدم سكل continue-plan و ship-change. الجوهر بس، بدون تشتيت، ولا تلمس ملفات برا المهمة.
```

## 3) A bug I saw on the iPhone (attach a screenshot)
```
في مشكلة بالآيفون (الصورة مرفقة): <شو صار، بأي صفحة، شو المفروض يصير>.
اقرأ docs/CONTEXT.md، لاقي السبب الحقيقي قبل ما تصلّح، صلّح بأقل تعديل، طبّق سكل iphone-ui، افحص وارفع.
```

## 4) A new feature
```
بدي ميزة: <وصف قصير>.
قبل ما تكتب كود: اقرأ docs/CONTEXT.md وقلّي بثلاث أسطر وين بتركب بالخطوات السبعة وأي محرّك مسؤول عنها. إذا بدها تعديل قاعدة بيانات استخدم سكل lovable-migration واعطيني برومبت Lovable. بعدين نفّذ وارفع.
```

## 5) A database change
```
استخدم سكل lovable-migration: <شو الجدول/العمود المطلوب وليش>. اكتب SQL آمن، ارفعه، واعطيني البرومبت جاهز ألصقه بـ Lovable. ولما أقلك "Lovable خلص" اسحب الأنواع وكمّل الكود.
```

## 6) After Lovable finishes applying a change
```
Lovable طبّق التعديل على قاعدة البيانات. اسحب من GitHub، تأكد إن types.ts فيه الأعمدة الجديدة، احذف نسختنا الأصلية من ملف الهجرة، وكمّل الكود اللي كان مستني.
```

## 7) Review before publishing
```
راجع آخر التعديلات على main (git log -10) بحثاً عن أخطاء حقيقية: حسابات المخاطرة والربح، الوقت واليوم، شكل الآيفون، أوامر سَنَد اللي لازم تستنى موافقتي. صلّح المؤكد بس، افحص وارفع، وقلّي النتيجة بسطرين.
```

## 8) When Claude gets scattered
```
وقف. ارجع لـ CLAUDE.md و docs/CONTEXT.md. قلّي بسطر واحد: شو المهمة الحالية، وأي ملفات بتلمسها. ما تعمل أي شي غير هاي المهمة.
```

---

## For Lovable (paste these into Lovable's own chat)
- **To apply a database change:** Claude gives you the prompt every time, and the copies are kept in `docs/lovable-migrations.md`.
- **For small design edits inside Lovable:** before you edit there, tell Claude which page you're working on, so you don't both change the same file at the same time.
