ALTER TABLE public.trading_settings
  ADD COLUMN IF NOT EXISTS weekly_target numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weekly_max_loss numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_target numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_max_loss numeric NOT NULL DEFAULT 0;
ALTER TABLE public.coach_messages ADD COLUMN IF NOT EXISTS actions jsonb;
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'morning',
  day date NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, day)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own notifications" ON public.notifications FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);