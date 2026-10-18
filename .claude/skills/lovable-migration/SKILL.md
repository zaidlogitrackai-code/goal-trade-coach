---
name: lovable-migration
description: Change the database of Hadi's app (new table, column, constraint, bucket, backfill). Lovable owns the database, so this writes idempotent SQL plus a ready prompt for the owner to paste into Lovable, then pulls the regenerated types. Use whenever a task needs a schema change.
---

# Database change through Lovable

1. Check the next number: `ls drizzle/migrations` (Lovable registers its own `00NN_apply_*.sql` copy; the last one is 0014).
2. Write `drizzle/migrations/00NN_<name>.sql`, **idempotent**:
   - `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`.
   - Policies inside `DO $$ … IF NOT EXISTS (SELECT 1 FROM pg_policies …) … $$`.
   - Constraints you replace: look the name up in `pg_constraint` inside a DO block (see `0014_apply_0014_corrective.sql`).
   - Every new table: owner-only RLS, copied from 0012:
     `GRANT SELECT, INSERT, UPDATE, DELETE … TO authenticated; GRANT ALL … TO service_role; ENABLE ROW LEVEL SECURITY; CREATE POLICY own_x … USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)`.
   - Storage buckets: Lovable refuses `INSERT INTO storage.buckets`; ask it in the prompt to create the bucket with its storage tooling.
3. Add the prompt to `docs/lovable-migrations.md` and give it to the owner in a code block:
   ```
   Apply the database migration drizzle/migrations/00NN_<name>.sql to Lovable Cloud exactly as written (do not rewrite it and do not change app code in src/). Register it in the drizzle journal like the previous ones, then regenerate src/integrations/supabase/types.ts so it includes <the new tables/columns>. Then confirm: <what to check>.
   ```
4. Commit + push the SQL alone (`ship-change`). No app code may read the new columns yet.
5. After the owner says Lovable finished: `git pull --ff-only origin main`, check `types.ts` has the new names, delete our original `00NN_<name>.sql` (Lovable's `_apply_` copy is the registered one), mark it applied in `docs/lovable-migrations.md`, push.
6. Only now write the code that uses the new columns.

## Never
Hand-edit `types.ts`, re-apply an already applied migration, or push code that reads a column before Lovable applied it.
