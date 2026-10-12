CREATE TABLE public.strategy_examples (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL,
 strategy_id uuid REFERENCES public.strategies(id) ON DELETE SET NULL,
 verdict text NOT NULL DEFAULT 'good',
 reason text NOT NULL DEFAULT '',
 symbol text, timeframe text, image text,
 created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategy_examples TO authenticated;
GRANT ALL ON public.strategy_examples TO service_role;
ALTER TABLE public.strategy_examples ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_examples ON public.strategy_examples FOR ALL TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);