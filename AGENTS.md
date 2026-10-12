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
- Discipline streak = login streak (user_visits, one row per day written silently by VisitRecorder) computed only in pure src/lib/streak.ts loginStreak (Mon–Fri, tz-aware); shown only on the discipline page and in AI context.
- Performance dashboard metrics (period windows, drawdown, R, streaks, calendar) come only from pure `src/lib/perf.ts` (tested) — keeps the numbers tz-correct and consistent.
- Each area (risk, strategies, discipline, analyst) is a dedicated agent chat thread via SessionAgent + coachReply mode (risk|strategy), hidden from the coach thread list — keeps everything conversational.
- Daily plan (target/trades/stop/max loss) lives in daily_plans (one row per day, revised_count tracks mid-day changes); greed/breach checks only in pure src/lib/daily-plan.ts — the discipline agent reads them from context.
- The agent persona is named سَنَد; every delete action is listed in DESTRUCTIVE so it always waits for a click — prevents accidental data loss in auto mode.
- Query defaults: staleTime 60s, no focus refetch, polling paused when the tab is hidden; backdrop blur only ≥768px — keeps the mobile app smooth.
- Live market data for the nine instruments comes only from `src/lib/market.server.ts`: TradingView public scanner for price/indicators (matches the chart), Yahoo candles shifted onto that price for structure; analyst-only, no on-screen ticker — free, no key.
- Notifications are hidden (`dismissed`), never deleted, by the bell's clear buttons — today's rows double as once-a-day locks (`dedupe_key`/`day`) for the daily AI messages, so deleting them regenerates duplicates.
- Chat sends go through `src/lib/chat-retry.ts` (`sendReliably`: on a network drop it watches the thread for the reply, resends once only if the message never arrived; coachReply runs its AI work under `keepAlive` (waitUntil via `src/lib/request-context.server.ts`, set in `src/server.ts`) so replies finish after a disconnect) and store only a small thumbnail in `coach_messages.image` — phone connections drop and must never lose or duplicate a message.
- Strategy training examples live in strategy_examples and are injected into every agent's context via buildContext; training progress score only in pure src/lib/training.ts — one learned profile shared by all agents.
- Money limits are stored also as % of balance (trading_settings.limits_pct) and turned into dollars only by src/lib/effective-limits.ts using the live capital balance — limits must follow deposits/corrections/P&L.
- Analyst paper self-test (10-min virtual scalps) runs client-side in `paper-test-panel.tsx` with pure `src/lib/paper-test.ts`; results go only into the analyst chat, never the trades table — keeps real stats clean.
