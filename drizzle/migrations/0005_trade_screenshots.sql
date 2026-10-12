ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS screenshot_path text;
CREATE POLICY "own_trade_shots_select" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'trade-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "own_trade_shots_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'trade-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "own_trade_shots_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'trade-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "own_trade_shots_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'trade-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);