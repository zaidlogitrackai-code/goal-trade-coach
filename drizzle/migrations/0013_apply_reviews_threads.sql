-- Step system part 2: per-trade / weekly reviews, trade events (stop moves), the analyst
-- card link, thread kinds (one سَنَد day thread + the analyst), and an action log for
-- idempotent, undoable AI actions. Idempotent; owner-only RLS on every new table.

-- (a) reviews: one per closed trade, plus day / weekly / monthly period reviews
CREATE TABLE IF NOT EXISTS public.trade_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  trade_id uuid UNIQUE REFERENCES public.trades(id) ON DELETE CASCADE,
  review_type text NOT NULL CHECK (review_type IN ('single_trade','partial_close','day','weekly','monthly')),
  period_key text,
  verdict text NOT NULL CHECK (verdict IN ('ok','warn','review','violation','cooldown')),
  process_score integer,
  risk_score integer,
  execution_score integer,
  quality_score integer,
  root_cause text CHECK (root_cause IN ('thesis_quality','execution','risk_sizing','market_environment','rule_violation','randomness','unknown')),
  outcome text,
  quadrant text,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  facts jsonb,
  answer text,
  decision text NOT NULL DEFAULT 'journal_only' CHECK (decision IN ('accept_rules','modify_rules','defer','journal_only')),
  ai_summary text,
  ai_extra jsonb,
  model text,
  prompt_version text,
  schema_version smallint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS trade_reviews_period_once
  ON public.trade_reviews (user_id, review_type, period_key) WHERE trade_id IS NULL;

-- (b) what happened during a trade (makes "stop moved" detectable)
CREATE TABLE IF NOT EXISTS public.trade_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  trade_id uuid NOT NULL REFERENCES public.trades(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('stop_moved','tp_moved','partial_close','size_added','note')),
  old_value numeric,
  new_value numeric,
  planned boolean,
  note text
);
CREATE INDEX IF NOT EXISTS trade_events_trade ON public.trade_events (trade_id, at);

-- (c) analyst card -> the trade it became
ALTER TABLE public.chart_analyses
  ADD COLUMN IF NOT EXISTS card jsonb,
  ADD COLUMN IF NOT EXISTS trade_id uuid REFERENCES public.trades(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS thread_id uuid;

-- (d) thread kinds: one day thread per trading day, the analyst, setup
ALTER TABLE public.coach_threads
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'legacy' CHECK (kind IN ('legacy','day','analyst','setup','chat')),
  ADD COLUMN IF NOT EXISTS day date;
UPDATE public.coach_threads SET kind = 'analyst' WHERE kind = 'legacy' AND title LIKE 'المحلل الذكي ·%';
CREATE UNIQUE INDEX IF NOT EXISTS coach_threads_one_day ON public.coach_threads (user_id, day) WHERE kind = 'day';

-- (e) message kinds, so alerts / review cards are never mistaken for the AI's reply
ALTER TABLE public.coach_messages
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat','alert','morning','review','system')),
  ADD COLUMN IF NOT EXISTS image_path text;

-- (f) every AI action, once (message_id + index is the idempotency key)
CREATE TABLE IF NOT EXISTS public.agent_action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  thread_id uuid,
  message_id uuid,
  action_index integer,
  action_type text NOT NULL,
  class text CHECK (class IN ('JOURNAL','STATE','DESTRUCTIVE')),
  mode text CHECK (mode IN ('auto','click')),
  status text CHECK (status IN ('done','failed','rejected','needs_confirmation','undone')),
  target_table text,
  target_id uuid,
  before jsonb,
  after jsonb,
  error text,
  UNIQUE (message_id, action_index)
);

-- (g) private bucket for chat images, one folder per user

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trade_reviews TO authenticated;
GRANT ALL ON public.trade_reviews TO service_role;
ALTER TABLE public.trade_reviews ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trade_events TO authenticated;
GRANT ALL ON public.trade_events TO service_role;
ALTER TABLE public.trade_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_action_log TO authenticated;
GRANT ALL ON public.agent_action_log TO service_role;
ALTER TABLE public.agent_action_log ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trade_reviews' AND policyname = 'own_trade_reviews') THEN
    CREATE POLICY own_trade_reviews ON public.trade_reviews FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trade_events' AND policyname = 'own_trade_events') THEN
    CREATE POLICY own_trade_events ON public.trade_events FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'agent_action_log' AND policyname = 'own_agent_action_log') THEN
    CREATE POLICY own_agent_action_log ON public.agent_action_log FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'own_chat_images_select') THEN
    CREATE POLICY own_chat_images_select ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'chat-images' AND (storage.foldername(name))[1] = auth.uid()::text);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'own_chat_images_insert') THEN
    CREATE POLICY own_chat_images_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'chat-images' AND (storage.foldername(name))[1] = auth.uid()::text);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'own_chat_images_delete') THEN
    CREATE POLICY own_chat_images_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'chat-images' AND (storage.foldername(name))[1] = auth.uid()::text);
  END IF;
END $$;
