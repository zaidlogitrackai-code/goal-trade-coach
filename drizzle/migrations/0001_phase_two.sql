ALTER TABLE public.trading_settings ADD COLUMN IF NOT EXISTS cooldown_until timestamptz, ADD COLUMN IF NOT EXISTS cooldown_minutes integer NOT NULL DEFAULT 30;

CREATE TABLE public.chart_analyses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, symbol text, timeframe text, question text, result text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.coach_threads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, title text NOT NULL DEFAULT 'محادثة جديدة', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.coach_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, thread_id uuid NOT NULL REFERENCES public.coach_threads(id) ON DELETE CASCADE, role text NOT NULL CHECK (role IN ('user','assistant')), content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.knowledge_notes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, title text NOT NULL, category text NOT NULL DEFAULT 'عام', content text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.trading_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz, plan text, review text, mood text);

DO $$ DECLARE t text; BEGIN
FOREACH t IN ARRAY ARRAY['chart_analyses','coach_threads','coach_messages','knowledge_notes','trading_sessions'] LOOP
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('CREATE POLICY owner_select ON public.%I FOR SELECT TO authenticated USING (auth.uid() = user_id)', t);
  EXECUTE format('CREATE POLICY owner_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)', t);
  EXECUTE format('CREATE POLICY owner_update ON public.%I FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)', t);
  EXECUTE format('CREATE POLICY owner_delete ON public.%I FOR DELETE TO authenticated USING (auth.uid() = user_id)', t);
END LOOP; END $$;
CREATE INDEX ON public.coach_messages(thread_id, created_at);