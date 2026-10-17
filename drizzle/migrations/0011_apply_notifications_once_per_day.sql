-- 0002 declared UNIQUE (user_id, kind, day) on notifications, which silently drops every
-- risk alert / reminder after the first one of the day. Only the once-a-day messages
-- (morning, evening) need that lock; risk and reminder rows are deduped by dedupe_key (0003).
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.notifications'::regclass
      AND con.contype = 'u'
      AND (
        SELECT array_agg(att.attname::text ORDER BY att.attname)
        FROM unnest(con.conkey) AS k(attnum)
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
      ) = ARRAY['day', 'kind', 'user_id']
  LOOP
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_daily_once
  ON public.notifications (user_id, kind, day)
  WHERE kind IN ('morning', 'evening');
