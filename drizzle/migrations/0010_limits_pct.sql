ALTER TABLE public.trading_settings ADD COLUMN IF NOT EXISTS limits_pct jsonb;
UPDATE public.trading_settings SET limits_pct = jsonb_strip_nulls(jsonb_build_object(
 'daily_target', CASE WHEN daily_target>0 THEN 3 END,
 'max_daily_profit', CASE WHEN max_daily_profit>0 THEN 3 END,
 'max_daily_loss', CASE WHEN max_daily_loss>0 THEN round(max_daily_loss/starting_balance*100,4) END,
 'max_risk_per_trade', CASE WHEN max_risk_per_trade>0 THEN round(max_risk_per_trade/starting_balance*100,4) END,
 'max_daily_risk', CASE WHEN max_daily_risk>0 THEN round(max_daily_risk/starting_balance*100,4) END,
 'weekly_target', CASE WHEN weekly_target>0 THEN round(weekly_target/starting_balance*100,4) END,
 'weekly_max_loss', CASE WHEN weekly_max_loss>0 THEN round(weekly_max_loss/starting_balance*100,4) END,
 'monthly_target', CASE WHEN monthly_target>0 THEN round(monthly_target/starting_balance*100,4) END,
 'monthly_max_loss', CASE WHEN monthly_max_loss>0 THEN round(monthly_max_loss/starting_balance*100,4) END
)) WHERE starting_balance > 0;