# Database changes for the step system (سَنَد — نظام الخطوات)

**Status: applied by Lovable on 2026-10-18** as `0011_apply_*`, `0012_apply_*` and `0013_apply_*` (registered in the journal; types.ts regenerated). The storage buckets were created through Lovable's storage tooling, not SQL. The prompt below is kept for reference.

Lovable manages the database, so these SQL files only take effect once Lovable applies them.
Paste the prompt below into the Lovable chat once. All three files are idempotent and safe to run more than once.

---

Apply these three database migrations to Lovable Cloud, in this order, exactly as written. They are in the repo:

1. `drizzle/migrations/0011_notifications_once_per_day.sql`
2. `drizzle/migrations/0012_discipline_journal.sql`
3. `drizzle/migrations/0013_reviews_threads.sql`

Requirements:
- Run the SQL exactly as written. Do not rewrite it, and do not change any app code in `src/`.
- Register them in `drizzle/migrations/meta/_journal.json` the same way as 0000–0010, if your migration flow needs that.
- After applying, regenerate `src/integrations/supabase/types.ts` so it includes the new tables (`circuit_breaks`, `pre_trade_checks`, `trade_reviews`, `trade_events`, `agent_action_log`) and the new columns on `trades`, `daily_plans`, `trading_settings`, `rule_violations`, `chart_analyses`, `coach_threads` and `coach_messages`.
- Then confirm in the chat:
  - The UNIQUE (user_id, kind, day) constraint on `notifications` is gone, and the index `notifications_daily_once` exists.
  - The new tables have RLS enabled with the owner-only policy.
  - The `trade-screenshots` and `chat-images` storage buckets exist.
