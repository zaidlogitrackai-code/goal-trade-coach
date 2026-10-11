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
