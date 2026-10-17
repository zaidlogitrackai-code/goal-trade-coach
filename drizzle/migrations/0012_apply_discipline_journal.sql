-- Step system (سَنَد — نظام الخطوات): circuit-breaker latch, pre-trade decision journal,
-- real daily-plan columns and the trade columns per-trade review needs.
-- Idempotent; every new table is owner-only (same RLS as 0004).

-- (a) settings
ALTER TABLE public.trading_settings
  ADD COLUMN IF NOT EXISTS streak_cooldown_hours numeric NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS limits_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS breaker_since timestamptz,
  ADD COLUMN IF NOT EXISTS coach_auto boolean,
  ADD COLUMN IF NOT EXISTS notification_sound boolean NOT NULL DEFAULT true;

-- (b) daily plan as the only per-day store
ALTER TABLE public.daily_plans
  ADD COLUMN IF NOT EXISTS no_trading boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rules_today jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS start_balance numeric,
  ADD COLUMN IF NOT EXISTS next_rule text,
  ADD COLUMN IF NOT EXISTS rules_ack_at timestamptz;

-- (c) latched halts: editing or deleting a losing trade must not clear an active halt
CREATE TABLE IF NOT EXISTS public.circuit_breaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  rule text NOT NULL CHECK (rule IN ('max_daily_loss','losing_streak_cooldown','weekly_drawdown_halt','monthly_drawdown_halt','incomplete_data','manual_pause','manual_cooldown')),
  state text NOT NULL CHECK (state IN ('COOLDOWN','HALTED')),
  threshold numeric,
  observed numeric,
  period_key text NOT NULL,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  active_until timestamptz,
  released_at timestamptz,
  detail text,
  UNIQUE (user_id, rule, period_key)
);

-- (d) every pre-trade decision, GO included, is journaled before the trade row
CREATE TABLE IF NOT EXISTS public.pre_trade_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  trade_id uuid REFERENCES public.trades(id) ON DELETE SET NULL,
  session_id uuid REFERENCES public.trading_sessions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'form' CHECK (source IN ('form','ai')),
  intent text NOT NULL CHECK (intent IN ('pre_entry','already_placed','historical')),
  symbol text,
  direction text,
  decision text NOT NULL CHECK (decision IN ('GO','NO_ACTIONABLE','REVIEW_REQUIRED','NO_GO')),
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  answers jsonb,
  planned_risk numeric,
  actual_risk numeric,
  max_lots numeric,
  position_size numeric,
  upstream text,
  minutes_since_loss integer,
  ai_plan_match text,
  ai_note text,
  proceeded boolean,
  override_reason text,
  schema_version smallint NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS pre_trade_checks_user_created ON public.pre_trade_checks (user_id, created_at DESC);

-- (e) trades: link to the decision and session, keep the planned stop, record why it closed
ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS pre_trade_check_id uuid REFERENCES public.pre_trade_checks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS initial_stop_loss numeric,
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.trading_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source text CHECK (source IN ('form','ai_chat','screenshot','import','backfill')),
  ADD COLUMN IF NOT EXISTS client_ref uuid UNIQUE,
  ADD COLUMN IF NOT EXISTS exit_reason text CHECK (exit_reason IN ('target','stop','invalidation','fear','time','trailing','other')),
  ADD COLUMN IF NOT EXISTS exit_emotion text,
  ADD COLUMN IF NOT EXISTS risk_source text CHECK (risk_source IN ('typed','computed','legacy_recomputed','unknown'));
CREATE INDEX IF NOT EXISTS trades_session_id ON public.trades (session_id);

UPDATE public.trades SET initial_stop_loss = stop_loss WHERE initial_stop_loss IS NULL AND stop_loss IS NOT NULL;
UPDATE public.trades SET risk_source = 'unknown' WHERE risk_source IS NULL AND coalesce(risk_amount, 0) = 0;
UPDATE public.trades t SET session_id = s.id
FROM public.trading_sessions s
WHERE t.session_id IS NULL
  AND s.user_id = t.user_id
  AND t.opened_at >= s.started_at
  AND t.opened_at <= coalesce(s.ended_at, now());

-- (f) where a violation came from
ALTER TABLE public.rule_violations
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','gate','breaker','plan','ai')),
  ADD COLUMN IF NOT EXISTS pre_trade_check_id uuid REFERENCES public.pre_trade_checks(id) ON DELETE SET NULL;

-- (g) 0005 created the policies but never the bucket

-- owner-only access on the new tables
GRANT SELECT, INSERT, UPDATE, DELETE ON public.circuit_breaks TO authenticated;
GRANT ALL ON public.circuit_breaks TO service_role;
ALTER TABLE public.circuit_breaks ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pre_trade_checks TO authenticated;
GRANT ALL ON public.pre_trade_checks TO service_role;
ALTER TABLE public.pre_trade_checks ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'circuit_breaks' AND policyname = 'own_circuit_breaks') THEN
    CREATE POLICY own_circuit_breaks ON public.circuit_breaks FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pre_trade_checks' AND policyname = 'own_pre_trade_checks') THEN
    CREATE POLICY own_pre_trade_checks ON public.pre_trade_checks FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
