-- Corrections after 0011-0013 (applied by Lovable as *_apply_*). Idempotent; owner-only RLS
-- on the new table. CHECK constraints are found by name in pg_constraint, as in 0011.

-- (a) agent_action_log: actions are claimed ('running') before they run, so a re-approval
--     after a crash can never repeat them.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.agent_action_log'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.agent_action_log DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE public.agent_action_log ADD CONSTRAINT agent_action_log_status_check
  CHECK (status IN ('running','done','failed','rejected','needs_confirmation','undone'));

-- (b) realtime for the open chat thread (replaces the 15s poll)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'coach_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.coach_messages;
  END IF;
END $$;

-- (c) redo the session link: 0012 matched coalesce(ended_at, now()), so a session left open
--     absorbed every later trade. Only the same Riyadh day counts now. No app code writes
--     trades.session_id yet, so a reset is safe.
UPDATE public.trades SET session_id = NULL WHERE session_id IS NOT NULL;
UPDATE public.trades t SET session_id = m.sid
FROM (
  SELECT DISTINCT ON (t2.id) t2.id, s.id AS sid
  FROM public.trades t2
  JOIN public.trading_sessions s
    ON s.user_id = t2.user_id
   AND (s.started_at AT TIME ZONE 'Asia/Riyadh')::date = (t2.opened_at AT TIME ZONE 'Asia/Riyadh')::date
   AND t2.opened_at >= s.started_at
   AND t2.opened_at <= coalesce(
         s.ended_at,
         (date_trunc('day', s.started_at AT TIME ZONE 'Asia/Riyadh') + interval '1 day') AT TIME ZONE 'Asia/Riyadh'
       )
  ORDER BY t2.id, s.started_at DESC
) m
WHERE t.id = m.id;

-- (d) settings: when the unreviewed-trade rule starts (NULL = off), and when a manual pause ends
ALTER TABLE public.trading_settings
  ADD COLUMN IF NOT EXISTS reviews_since timestamptz,
  ADD COLUMN IF NOT EXISTS paused_until timestamptz;
-- an old forgotten pause ends at the next local midnight
UPDATE public.trading_settings
SET paused_until = (date_trunc('day', now() AT TIME ZONE coalesce(nullif(timezone, ''), 'Asia/Riyadh')) + interval '1 day')
                   AT TIME ZONE coalesce(nullif(timezone, ''), 'Asia/Riyadh')
WHERE trading_paused = true AND paused_until IS NULL;

-- (e) realized P&L of a partial close
ALTER TABLE public.trade_events ADD COLUMN IF NOT EXISTS realized_pnl numeric;

-- (f) pre_trade_checks: the analyst may say "watch"
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.pre_trade_checks'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%intent%'
  LOOP
    EXECUTE format('ALTER TABLE public.pre_trade_checks DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE public.pre_trade_checks ADD CONSTRAINT pre_trade_checks_intent_check
  CHECK (intent IN ('pre_entry','already_placed','historical','watch'));

-- (g) every legacy trade is tagged, so reviews can tell old rows from new ones
UPDATE public.trades SET source = 'backfill' WHERE source IS NULL;

-- (h) capital movements move out of the hidden knowledge_notes ledger into a real table
CREATE TABLE IF NOT EXISTS public.capital_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  at timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind IN ('deposit','withdrawal','adjust')),
  amount numeric NOT NULL,
  note text,
  legacy_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, legacy_id)
);
CREATE INDEX IF NOT EXISTS capital_movements_user_at ON public.capital_movements (user_id, at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.capital_movements TO authenticated;
GRANT ALL ON public.capital_movements TO service_role;
ALTER TABLE public.capital_movements ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'capital_movements' AND policyname = 'own_capital_movements') THEN
    CREATE POLICY own_capital_movements ON public.capital_movements FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
