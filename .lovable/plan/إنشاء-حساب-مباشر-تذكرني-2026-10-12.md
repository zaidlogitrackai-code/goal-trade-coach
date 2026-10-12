# إنشاء حساب مباشر + "تذكرني"

## وش بيتغيّر
1. **إنشاء الحساب يفتح على طول:** تكتب الإيميل والباسورد، وتضغط "إنشاء حساب"، وتدخل لوحتك مباشرة. ما فيه رسالة تأكيد على الإيميل.
2. **خيار "تذكرني"** في صفحة الدخول وإنشاء الحساب:
   - **مفعّل** (من البداية): تبقى مسجّل دخول دايماً على هذا الجهاز حتى لو سكّرت المتصفح، وإيميلك يكون مكتوب جاهز المرة الجاية.
   - **مو مفعّل:** يطلّعك من حسابك لما تسكّر المتصفح.
3. **رسائل الأخطاء بالعربي:** مثل "الإيميل مسجّل من قبل" أو "الباسورد غلط".

## تنبيه
لما نشيل تأكيد الإيميل، أي أحد يقدر يسوي حساب بأي إيميل، حتى لو الإيميل مو له. بياناتك بأمان، لأن كل حساب يشوف بياناته هو بس. لكن انتبه: أي أحد يفتح الموقع يقدر يسوي حساب.

## Technical details
- Enable auto-confirm via `supabase--configure_auth` (auto_confirm_email: true).
- `src/routes/auth.tsx`: after `signUp`, if `data.session` exists navigate to `/dashboard`; add "تذكرني" checkbox; store last email in localStorage `hadi-last-email`.
- Remember off: set sessionStorage `hadi-session-only`=1 and localStorage `hadi-ephemeral`=1; in `__root.tsx` on startup, if `hadi-ephemeral` is set and the sessionStorage marker is missing (new browser session), call `supabase.auth.signOut()`.
