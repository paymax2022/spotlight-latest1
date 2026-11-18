-- RLS for the crypto watchlist/alerts tables created in
-- 20271200000063_crypto_watchlist_and_price_alerts.sql. Both are member-owned:
-- the Go backend reads/writes them as service role, members see only their own.
-- ADDITIVE-ONLY: enables RLS and adds policies; no existing object is altered.
BEGIN;

ALTER TABLE public.crypto_watchlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crypto_watchlist_owner ON public.crypto_watchlist;
CREATE POLICY crypto_watchlist_owner ON public.crypto_watchlist
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS crypto_watchlist_service ON public.crypto_watchlist;
CREATE POLICY crypto_watchlist_service ON public.crypto_watchlist
  TO service_role USING (TRUE) WITH CHECK (TRUE);

ALTER TABLE public.crypto_price_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crypto_price_alerts_owner ON public.crypto_price_alerts;
CREATE POLICY crypto_price_alerts_owner ON public.crypto_price_alerts
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS crypto_price_alerts_service ON public.crypto_price_alerts;
CREATE POLICY crypto_price_alerts_service ON public.crypto_price_alerts
  TO service_role USING (TRUE) WITH CHECK (TRUE);

COMMIT;
