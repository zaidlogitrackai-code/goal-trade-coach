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
