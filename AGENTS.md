<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Daily trading status is computed only in `src/lib/trading-status.ts` (pure, tested) — one source of truth for dashboard and trade form.
- App data is read/written from the browser Supabase client under owner-only RLS; protected pages live under `src/routes/_authenticated/` (ssr: false) — single-user personal app, no server functions needed yet.
- AI features (analyst, coach, report summary) run only through authenticated server functions in `src/lib/ai.functions.ts`, using `src/lib/ai.server.ts` (gateway call, streamed to final text) — keeps the API key server-side and grounds replies in the user's own data.
- Performance/discipline/report numbers come from pure helpers in `src/lib/stats.ts` — one calculation shared by every page.
- AI-proposed changes are structured actions (`src/lib/agent-actions.ts`) validated with zod and executed in the browser only after the user clicks approve — the AI never writes data on its own.
- The daily morning message is generated lazily on the first visit of the day (`morningGreeting`, unique per user/day) — no scheduler needed for a single-user app.
- Mobile navigation uses four fixed primary destinations plus a complete “more” sheet — stable icon positions reduce cognitive load while preserving every route.
- AI-created trades are de-duplicated via `src/lib/trade-dedupe.ts` (symbol+direction+entry, 24h) — re-uploading the same broker screenshot must never double-count.
- Risk alerts come only from pure `src/lib/risk-watch.ts`, run client-side every minute by `RiskWatcher` and de-duplicated via `notifications.dedupe_key` — in-app only (user chose no push), so alerts never repeat.
- Risk management page is a chat with the risk guardian (shared SessionAgent with title/mode props, thread "حارس المخاطر"; coachReply mode=risk adds RISK_MODE); daily morning note via riskMorning deduped by notifications.dedupe_key; RiskWatcher also posts alerts into that thread — one agent chat per area keeps everything conversational.
- Discipline streak is computed only in pure src/lib/streak.ts (market days Mon–Fri, tz-aware) and shared by StreakCard and the AI context.
- Performance dashboard metrics (period windows, drawdown, R, streaks, calendar) come only from pure `src/lib/perf.ts` (tested) — keeps the numbers tz-correct and consistent.
