-- RLS lockdown, wave 2 (same pattern as 20260703225152_rls_backend_only_lockdown.sql).
-- These 78 public tables were created by migrations timestamped AFTER the wave-1
-- lockdown ran (its to_regclass guards no-op'd on then-missing tables), so they
-- shipped without row-level security. All are reached ONLY by (a) the Go backend
-- as owner 'postgres' or (b) the Next.js server via the service-role client —
-- both BYPASS RLS. No browser/anon-key .from() usage touches them (re-verified
-- across web/admin/mobile on 2026-08-12). Enabling RLS with no policy = deny-all
-- for anon/authenticated; the REVOKE is defence-in-depth, guarded on role
-- existence so bare-Postgres CI is a no-op. NOT using FORCE RLS. Additive,
-- reversible, idempotent. Caveat: exposing any of these via PostgREST/Realtime
-- later needs an explicit policy.
BEGIN;

-- 1. Enable RLS (no role dependency; deny-all until a policy is added).
DO $rls$ BEGIN IF to_regclass('public.academy_announcements') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.academy_announcements ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.academy_learner_bookmarks') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.academy_learner_bookmarks ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.academy_learner_notes') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.academy_learner_notes ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.academy_learner_notifications') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.academy_learner_notifications ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.academy_mock_attempt_metadata') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.academy_mock_attempt_metadata ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.academy_mock_exam_instances') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.academy_mock_exam_instances ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.academy_mock_exam_templates') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.academy_mock_exam_templates ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.academy_mock_question_mappings') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.academy_mock_question_mappings ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.academy_mock_recommendations') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.academy_mock_recommendations ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.academy_mock_statistics') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.academy_mock_statistics ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.arena_authorized_adapter') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.arena_authorized_adapter ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.arena_competition_config') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.arena_competition_config ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.arena_pot_approval') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.arena_pot_approval ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.arena_pot_disbursement') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.arena_pot_disbursement ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.assoc_election_ballots_cast') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.assoc_election_ballots_cast ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.assoc_election_candidates') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.assoc_election_candidates ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.assoc_election_positions') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.assoc_election_positions ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.assoc_election_results') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.assoc_election_results ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.assoc_election_votes') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.assoc_election_votes ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.assoc_elections') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.assoc_elections ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.bridge_idempotency_keys') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.bridge_idempotency_keys ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.bridge_outbox') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.bridge_outbox ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.bus_departure_templates') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.bus_departure_templates ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.connect_account_restrictions') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.connect_account_restrictions ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.connect_credit_txns') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.connect_credit_txns ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.connect_credits') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.connect_credits ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.fre_assets') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.fre_assets ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.fre_audit_log') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.fre_audit_log ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.fre_auto_invest') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.fre_auto_invest ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.fre_cap_table') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.fre_cap_table ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.fre_distribution_payments') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.fre_distribution_payments ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.fre_distributions') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.fre_distributions ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.fre_documents') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.fre_documents ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.fre_goals') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.fre_goals ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.fre_investor_profiles') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.fre_investor_profiles ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.fre_limit_overrides') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.fre_limit_overrides ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.fre_market_controls') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.fre_market_controls ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.fre_offerings') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.fre_offerings ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.fre_risk_acknowledgements') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.fre_risk_acknowledgements ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.fre_secondary_listings') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.fre_secondary_listings ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.fre_secondary_orders') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.fre_secondary_orders ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.fre_sponsors') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.fre_sponsors ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.fre_subscriptions') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.fre_subscriptions ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.fre_watchlist') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.fre_watchlist ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.health_consult_recording_consents') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.health_consult_recording_consents ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.health_consult_referrals') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.health_consult_referrals ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.mkt_admin_audit_log') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.mkt_admin_audit_log ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.mkt_blocks') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.mkt_blocks ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.mkt_boosts') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.mkt_boosts ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.mkt_categories') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.mkt_categories ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.mkt_deal_reviews') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.mkt_deal_reviews ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.mkt_dispute_evidence') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.mkt_dispute_evidence ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.mkt_disputes') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.mkt_disputes ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.mkt_flags') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.mkt_flags ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.mkt_listing_media') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.mkt_listing_media ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.mkt_listings') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.mkt_listings ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.mkt_listings_outbox') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.mkt_listings_outbox ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.mkt_messages') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.mkt_messages ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.mkt_notification_prefs') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.mkt_notification_prefs ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.mkt_offers') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.mkt_offers ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.mkt_orders') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.mkt_orders ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.mkt_price_bands') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.mkt_price_bands ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.mkt_reports') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.mkt_reports ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.mkt_reviews') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.mkt_reviews ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.mkt_saved_items') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.mkt_saved_items ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.mkt_saved_searches') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.mkt_saved_searches ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.mkt_threads') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.mkt_threads ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.mkt_trust_scores') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.mkt_trust_scores ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.marketplace_activity_stream') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.marketplace_activity_stream ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.marketplace_audit_logs') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.marketplace_audit_logs ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.marketplace_metrics') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.marketplace_metrics ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.orch_beneficiaries') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.orch_beneficiaries ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.orch_fx_card_txns') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.orch_fx_card_txns ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.orch_fx_cards') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.orch_fx_cards ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.orch_fx_customer_verifications') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.orch_fx_customer_verifications ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.orch_rate_alerts') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.orch_rate_alerts ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.pharmacy_delivery_proofs') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.pharmacy_delivery_proofs ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.restaurant_order_status_events') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.restaurant_order_status_events ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;

-- 2. Revoke anon/authenticated grants, guarded so bare-Postgres CI is a no-op.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
      'academy_announcements'
    , 'academy_learner_bookmarks'
    , 'academy_learner_notes'
    , 'academy_learner_notifications'
    , 'academy_mock_attempt_metadata'
    , 'academy_mock_exam_instances'
    , 'academy_mock_exam_templates'
    , 'academy_mock_question_mappings'
    , 'academy_mock_recommendations'
    , 'academy_mock_statistics'
    , 'arena_authorized_adapter'
    , 'arena_competition_config'
    , 'arena_pot_approval'
    , 'arena_pot_disbursement'
    , 'assoc_election_ballots_cast'
    , 'assoc_election_candidates'
    , 'assoc_election_positions'
    , 'assoc_election_results'
    , 'assoc_election_votes'
    , 'assoc_elections'
    , 'bridge_idempotency_keys'
    , 'bridge_outbox'
    , 'bus_departure_templates'
    , 'connect_account_restrictions'
    , 'connect_credit_txns'
    , 'connect_credits'
    , 'fre_assets'
    , 'fre_audit_log'
    , 'fre_auto_invest'
    , 'fre_cap_table'
    , 'fre_distribution_payments'
    , 'fre_distributions'
    , 'fre_documents'
    , 'fre_goals'
    , 'fre_investor_profiles'
    , 'fre_limit_overrides'
    , 'fre_market_controls'
    , 'fre_offerings'
    , 'fre_risk_acknowledgements'
    , 'fre_secondary_listings'
    , 'fre_secondary_orders'
    , 'fre_sponsors'
    , 'fre_subscriptions'
    , 'fre_watchlist'
    , 'health_consult_recording_consents'
    , 'health_consult_referrals'
    , 'mkt_admin_audit_log'
    , 'mkt_blocks'
    , 'mkt_boosts'
    , 'mkt_categories'
    , 'mkt_deal_reviews'
    , 'mkt_dispute_evidence'
    , 'mkt_disputes'
    , 'mkt_flags'
    , 'mkt_listing_media'
    , 'mkt_listings'
    , 'mkt_listings_outbox'
    , 'mkt_messages'
    , 'mkt_notification_prefs'
    , 'mkt_offers'
    , 'mkt_orders'
    , 'mkt_price_bands'
    , 'mkt_reports'
    , 'mkt_reviews'
    , 'mkt_saved_items'
    , 'mkt_saved_searches'
    , 'mkt_threads'
    , 'mkt_trust_scores'
    , 'marketplace_activity_stream'
    , 'marketplace_audit_logs'
    , 'marketplace_metrics'
    , 'orch_beneficiaries'
    , 'orch_fx_card_txns'
    , 'orch_fx_cards'
    , 'orch_fx_customer_verifications'
    , 'orch_rate_alerts'
    , 'pharmacy_delivery_proofs'
    , 'restaurant_order_status_events'
  ] LOOP
    IF to_regclass('public.'||t) IS NULL THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;
COMMIT;
