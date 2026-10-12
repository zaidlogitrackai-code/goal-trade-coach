CREATE TABLE public.daily_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  day date NOT NULL,
  target numeric,
  max_trades integer,
  risk_per_trade numeric,
  max_loss numeric,
  note text,
  set_at timestamptz NOT NULL DEFAULT now(),
  revised_count integer NOT NULL DEFAULT 0,
  UNIQUE (user_id, day)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_plans TO authenticated;
GRANT ALL ON public.daily_plans TO service_role;
ALTER TABLE public.daily_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_daily_plans ON public.daily_plans FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);