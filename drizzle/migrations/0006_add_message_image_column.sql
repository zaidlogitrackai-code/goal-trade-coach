ALTER TABLE public.coach_messages ADD COLUMN IF NOT EXISTS image text;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_messages TO authenticated;
GRANT ALL ON public.coach_messages TO service_role;