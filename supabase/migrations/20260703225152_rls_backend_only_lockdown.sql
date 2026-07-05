-- RLS lockdown for backend-only + server-only tables (production-grade hardening).
-- Context:      132 public tables had NO row-level security while anon + authenticated
-- held full grants — readable/writable via PostgREST with the shipped anon key.
-- Every one is reached ONLY by (a) the Go backend as owner 'postgres', or (b) the
-- Next.js server via the service-role client (createAdminClient) — both BYPASS RLS.
-- No browser/anon-key .from() usage touches them (verified across web/admin/mobile).
-- Enabling RLS with no policy = deny-all for anon/authenticated; revoking grants is
-- defence-in-depth. NOT using FORCE RLS (that would also gate the owner). Excludes
-- extension-owned tables (postgis spatial_ref_sys). Additive, reversible, idempotent.
-- The REVOKE is guarded on role existence so this also applies on a bare Postgres
-- (CI without the Supabase role shim), where anon/authenticated are absent.
-- Caveat: a table later exposed via Supabase Realtime to anon/authenticated will
-- need an explicit SELECT policy for that subscription to receive rows.
BEGIN;

-- 1. Enable RLS (no role dependency; deny-all until a policy is added).
ALTER TABLE public.applicant_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arena_authorized_adapter ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arena_competition_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arena_pot_approval ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arena_pot_disbursement ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_ai_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_announcement_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_chat_thread_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_committees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_document_acks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_dues_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_event_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_meeting_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_member_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_member_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_membership_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_revenue_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assoc_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bridge_idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bridge_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_specialties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.election_eligibility_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_verification_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estate_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.handoff_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invest_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invest_admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invest_agreement_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invest_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invest_corporate_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invest_dividends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invest_fee_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invest_ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invest_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invest_limit_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invest_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invest_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invest_portfolio_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invest_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invest_price_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invest_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invest_public_offer_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invest_public_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invest_rights_issue_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invest_rights_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invest_stock_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invest_suitability_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invest_user_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invest_watchlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invest_watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onb_application ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onb_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onb_form_schema ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onb_merchant_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onb_merchant_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onb_module ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onb_review_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orch_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orch_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orch_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orch_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orch_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orch_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_transfer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.realtor_admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsor_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_applications_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_artifacts_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_badge_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_bootcamp_cohorts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_bootcamp_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_bootcamp_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_challenge_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_consent_records_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_contests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_emerging_innovators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_emerging_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_emerging_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_judge_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_judging_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_judging_rubrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_leaderboard_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_review_scores_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_school_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_school_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_school_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_sponsors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_status_history_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_team_members_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_vote_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_vote_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stem_voting_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tier_limit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 2. Revoke anon/authenticated grants, guarded so bare-Postgres CI is a no-op.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
      'applicant_leads'
    , 'arena_authorized_adapter'
    , 'arena_competition_config'
    , 'arena_pot_approval'
    , 'arena_pot_disbursement'
    , 'assoc_ai_notes'
    , 'assoc_announcement_reads'
    , 'assoc_announcements'
    , 'assoc_applications'
    , 'assoc_audit_log'
    , 'assoc_chapters'
    , 'assoc_chat_messages'
    , 'assoc_chat_thread_state'
    , 'assoc_chat_threads'
    , 'assoc_committees'
    , 'assoc_devices'
    , 'assoc_document_acks'
    , 'assoc_documents'
    , 'assoc_dues_invoices'
    , 'assoc_event_registrations'
    , 'assoc_events'
    , 'assoc_import_batches'
    , 'assoc_meeting_attendance'
    , 'assoc_meetings'
    , 'assoc_member_profiles'
    , 'assoc_member_roles'
    , 'assoc_membership_categories'
    , 'assoc_memberships'
    , 'assoc_notifications'
    , 'assoc_organisations'
    , 'assoc_payments'
    , 'assoc_revenue_splits'
    , 'assoc_support_messages'
    , 'assoc_support_tickets'
    , 'assoc_tasks'
    , 'audit_logs'
    , 'auth_sessions'
    , 'bridge_idempotency_keys'
    , 'bridge_outbox'
    , 'chat_events'
    , 'chat_messages'
    , 'chat_sessions'
    , 'doctor_specialties'
    , 'election_eligibility_rules'
    , 'email_verification_tokens'
    , 'estate_config'
    , 'handoff_requests'
    , 'invest_accounts'
    , 'invest_admin_audit_log'
    , 'invest_agreement_acceptances'
    , 'invest_agreements'
    , 'invest_corporate_actions'
    , 'invest_dividends'
    , 'invest_fee_config'
    , 'invest_ledger_accounts'
    , 'invest_ledger_entries'
    , 'invest_limit_config'
    , 'invest_order_events'
    , 'invest_orders'
    , 'invest_portfolio_snapshots'
    , 'invest_positions'
    , 'invest_price_alerts'
    , 'invest_profiles'
    , 'invest_public_offer_applications'
    , 'invest_public_offers'
    , 'invest_rights_issue_applications'
    , 'invest_rights_issues'
    , 'invest_stock_assets'
    , 'invest_suitability_profiles'
    , 'invest_user_pins'
    , 'invest_watchlist_items'
    , 'invest_watchlists'
    , 'knowledge_documents'
    , 'lead_records'
    , 'login_activity'
    , 'meeting_attendees'
    , 'meeting_documents'
    , 'onb_application'
    , 'onb_document'
    , 'onb_form_schema'
    , 'onb_merchant_profile'
    , 'onb_merchant_type'
    , 'onb_module'
    , 'onb_review_task'
    , 'orch_balances'
    , 'orch_collections'
    , 'orch_conversions'
    , 'orch_ledger_entries'
    , 'orch_quotes'
    , 'orch_transfers'
    , 'password_reset_tokens'
    , 'permissions'
    , 'platform_users'
    , 'profiles'
    , 'property_transfer_requests'
    , 'realtor_admin_audit_log'
    , 'role_permissions'
    , 'roles'
    , 'security_events'
    , 'sponsor_leads'
    , 'stem_applications_v2'
    , 'stem_artifacts_v2'
    , 'stem_badge_awards'
    , 'stem_badges'
    , 'stem_bootcamp_cohorts'
    , 'stem_bootcamp_scores'
    , 'stem_bootcamp_tasks'
    , 'stem_certificates'
    , 'stem_challenge_templates'
    , 'stem_consent_records_v2'
    , 'stem_contests'
    , 'stem_emerging_innovators'
    , 'stem_emerging_projects'
    , 'stem_emerging_teams'
    , 'stem_judge_assignments'
    , 'stem_judging_criteria'
    , 'stem_judging_rubrics'
    , 'stem_leaderboard_entries'
    , 'stem_review_scores_v2'
    , 'stem_school_profiles'
    , 'stem_school_teams'
    , 'stem_school_verifications'
    , 'stem_schools'
    , 'stem_sponsors'
    , 'stem_status_history_v2'
    , 'stem_team_members_v2'
    , 'stem_vote_packages'
    , 'stem_vote_transactions'
    , 'stem_voting_rules'
    , 'tier_limit_events'
    , 'user_permissions'
    , 'user_roles'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;
COMMIT;
