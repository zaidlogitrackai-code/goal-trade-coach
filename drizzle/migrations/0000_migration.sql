
CREATE TABLE public.trading_settings (
  user_id uuid PRIMARY KEY,
  display_name text,
  currency text NOT NULL DEFAULT 'USD',
  timezone text NOT NULL DEFAULT 'Asia/Riyadh',
  starting_balance numeric NOT NULL DEFAULT 0,
  daily_target numeric NOT NULL DEFAULT 0,
  max_daily_profit numeric NOT NULL DEFAULT 0,
  max_daily_loss numeric NOT NULL DEFAULT 0,
  max_trades_per_day int NOT NULL DEFAULT 0,
  max_risk_per_trade numeric NOT NULL DEFAULT 0,
  max_daily_risk numeric NOT NULL DEFAULT 0,
  max_consecutive_losses int NOT NULL DEFAULT 0,
  session_start time,
  session_end time,
  trading_paused boolean NOT NULL DEFAULT false,
  onboarded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  entry_conditions text,
  exit_conditions text,
  markets text,
  timeframes text,
  allowed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.trading_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('long','short')),
  strategy_id uuid REFERENCES public.strategies(id) ON DELETE SET NULL,
  entry_price numeric,
  stop_loss numeric,
  take_profit numeric,
  position_size numeric,
  risk_amount numeric NOT NULL DEFAULT 0,
  emotion text,
  checklist_passed boolean NOT NULL DEFAULT false,
  notes text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  exit_price numeric,
  pnl numeric,
  close_notes text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.rule_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  rule_id uuid REFERENCES public.trading_rules(id) ON DELETE CASCADE,
  trade_id uuid REFERENCES public.trades(id) ON DELETE SET NULL,
  note text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['trading_settings','strategies','trading_rules','trades','rule_violations'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "owner_select" ON public.%I FOR SELECT TO authenticated USING (auth.uid() = user_id)', t);
    EXECUTE format('CREATE POLICY "owner_insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)', t);
    EXECUTE format('CREATE POLICY "owner_update" ON public.%I FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)', t);
    EXECUTE format('CREATE POLICY "owner_delete" ON public.%I FOR DELETE TO authenticated USING (auth.uid() = user_id)', t);
  END LOOP;
END $$;

CREATE INDEX trades_user_opened_idx ON public.trades (user_id, opened_at DESC);
