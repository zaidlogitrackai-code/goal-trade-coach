export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <title>تعذّر تحميل الصفحة</title>
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0a0a0a" />
    <style>
      :root { color-scheme: dark; }
      html { background: #080808; }
      body { font: 15px/1.6 -apple-system, BlinkMacSystemFont, "SF Arabic", system-ui, sans-serif; background: #0a0a0a; color: #F5F5F7; display: grid; place-items: center; min-height: 100vh; min-height: 100dvh; margin: 0; padding: max(1.5rem, env(safe-area-inset-top)) 1.5rem max(1.5rem, env(safe-area-inset-bottom)); box-sizing: border-box; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem 1rem; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #B8B5B1; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 1.25rem; border-radius: 0.75rem; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #F2F2F2; color: #0D0D0D; font-weight: 600; }
      .secondary { background: transparent; color: #F5F5F7; border-color: rgba(255,255,255,0.22); }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>تعذّر تحميل الصفحة</h1>
      <p>صار خلل من عندنا. جرّب تحدّث الصفحة أو ارجع للرئيسية.</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">حاول مرة ثانية</button>
        <a class="secondary" href="/">الرئيسية</a>
      </div>
    </div>
  </body>
</html>`;
}
