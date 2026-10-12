CREATE TABLE public.user_visits (
 user_id uuid NOT NULL,
 day date NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id, day));
GRANT SELECT, INSERT ON public.user_visits TO authenticated;
GRANT ALL ON public.user_visits TO service_role;
ALTER TABLE public.user_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_visits_select ON public.user_visits FOR SELECT TO authenticated USING (auth.uid()=user_id);
CREATE POLICY own_visits_insert ON public.user_visits FOR INSERT TO authenticated WITH CHECK (auth.uid()=user_id);