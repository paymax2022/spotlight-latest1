-- ============================================================================
-- probe_residue_cleanup_v2 — second one-off DATA cleanup of E2E probe residue
-- on prod. Follows 20271007040000_probe_residue_cleanup.sql (v1).
--
-- Scope: every statement is scoped to explicit ids/uuids (or the 'e2e-' /
-- 'probe://' probe markers) taken from the wave-7 lane reports under
-- /tmp/e2e-fix2. No broad patterns.
--
-- IMPORTANT — fixture uuid correction: v1 scoped its ysf predicates to
-- '648e1080-d66e-4e55-b8d8-72bc51acc3af'. Every live API response and JWT
-- 'sub' claim for ysfakinleye@gmail.com shows the real id is
-- '648e1080-d66e-4e53-b8d8-72bc51acc3af' ('4e53', not '4e55' — the '4e55'
-- value only ever appeared in v7-probe-guide.md). v1's ysf-scoped statements
-- therefore matched zero rows on prod. Sections 3-16 below re-run every
-- v1 predicate that carried the wrong uuid, corrected to '4e53'. Predicates
-- anchored on the verified ayaa uuid '00367732-a1f0-4bb0-b711-235facd82685'
-- or on uuid-free markers (share_code, exact references, the '4e345a66'
-- name-marker group) already ran correctly under v1 and are NOT repeated,
-- except where noted as cheap idempotent companions.
--
-- Fixture accounts:
--   ysf  = 648e1080-d66e-4e53-b8d8-72bc51acc3af  (ysfakinleye@gmail.com)
--   ayaa = 00367732-a1f0-4bb0-b711-235facd82685  (ayaaakinleye, backup)
--   probe throwaway = 29b7e850-1727-42fa-b2bd-71bb7289d299
--                     (e2e-bridge-verify-1791342988@example.invalid)
--
-- Safety notes:
--   * Each block is guarded by to_regclass() so prod schema drift cannot
--     abort the run mid-file; every DO block also traps EXCEPTION WHEN OTHERS.
--   * Ledger-aware rule (same posture as v1 §4): rows referenced by posted
--     ledger entries are NEVER deleted — ledger-referenced groups are
--     renamed, a ledger-referenced principal is skipped with a NOTICE.
--     No money-path tables are written: nothing here touches ledger_entries,
--     wallets, escrow_holds or any balance column.
--   * scheduler_jobs rows are CANCELLED, not deleted (audit-friendly).
--   * Consent/audit rows (kyc_events et al.) are deliberately LEFT in place —
--     append-only compliance records by design.
-- ============================================================================

BEGIN;

-- ── 1. throwaway bridge-verify probe account ───────────────────────────────
-- 29b7e850 / e2e-bridge-verify-1791342988@example.invalid — register probe
-- created AFTER the platform_users bridge repair, so it HAS a mirror row.
-- Delete the mirror first (inner guarded block), then the auth.users row
-- (inner guarded block, v1 §15 pattern). If the account is ledger-referenced,
-- both deletes are skipped — ledger entries are immutable.
DO $$
DECLARE n int; v_blocked boolean := false;
BEGIN
  IF to_regclass('public.ledger_accounts') IS NOT NULL
     AND to_regclass('public.ledger_entries') IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.ledger_accounts la
         JOIN public.ledger_entries le ON le.account_id = la.id
        WHERE la.user_id = '29b7e850-1727-42fa-b2bd-71bb7289d299') THEN
    v_blocked := true;
    RAISE NOTICE 'probe account is ledger-referenced — deletes skipped (ledger entries are immutable)';
  END IF;

  IF NOT v_blocked THEN
    IF to_regclass('public.platform_users') IS NOT NULL THEN
      BEGIN
        DELETE FROM public.platform_users
         WHERE id = '29b7e850-1727-42fa-b2bd-71bb7289d299';
        GET DIAGNOSTICS n = ROW_COUNT;
        RAISE NOTICE 'platform_users probe mirror deleted: %', n;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'platform_users probe mirror delete skipped: %', SQLERRM;
      END;
    ELSE
      RAISE NOTICE 'platform_users absent — skipped';
    END IF;

    BEGIN
      DELETE FROM auth.users
       WHERE id = '29b7e850-1727-42fa-b2bd-71bb7289d299'
         AND email = 'e2e-bridge-verify-1791342988@example.invalid';
      GET DIAGNOSTICS n = ROW_COUNT;
      RAISE NOTICE 'auth.users probe account deleted: %', n;
    EXCEPTION WHEN foreign_key_violation OR others THEN
      RAISE NOTICE 'auth.users probe account delete skipped: %', SQLERRM;
    END;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'probe cleanup section skipped: %', SQLERRM;
END $$;

-- ── 2. mkt_verification_requests: pending probe request on ysf ─────────────
-- id 11adc122-bf8d-4900-8dc6-157cddbb5862, artifact
-- 'probe://e2e-residue/verify-id-doc'. Matched on the primary key AND the
-- exact probe:// marker so only the probe row can ever qualify.
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.mkt_verification_requests') IS NOT NULL THEN
    DELETE FROM public.mkt_verification_requests
     WHERE id = '11adc122-bf8d-4900-8dc6-157cddbb5862'
       AND user_id = '648e1080-d66e-4e53-b8d8-72bc51acc3af'
       AND status = 'pending'
       AND payload->>'document_url' = 'probe://e2e-residue/verify-id-doc';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'mkt_verification_requests probe row deleted: %', n;
  ELSE
    RAISE NOTICE 'mkt_verification_requests absent — skipped';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'probe cleanup section skipped: %', SQLERRM;
END $$;

-- ── 3. KYC: idempotent re-run of v1 §11 on ysf ──────────────────────────────
-- v1 targeted '4e55' and matched nothing; prod still shows
-- kycStatus='pending'. Same predicates, corrected uuid, plus a 'probe://'
-- document_ref marker variant. verification_session '6271d0e2%' was also
-- keyed on '4e55' and is re-run here. kyc_events LEFT as audit trail.
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.user_profiles') IS NOT NULL THEN
    UPDATE public.user_profiles
       SET kyc_status = 'unverified',
           kyc_requested_tier = NULL,
           kyc_submitted_at = NULL,
           document_ref = CASE
             WHEN document_ref LIKE 'r2://probe/%'
               OR document_ref LIKE 'probe://%'
               OR document_ref ILIKE '%probe%'
               OR document_ref ILIKE '%example.com%' THEN NULL
             ELSE document_ref END,
           updated_at = now()
     WHERE id = '648e1080-d66e-4e53-b8d8-72bc51acc3af'
       AND kyc_status = 'pending'
       AND kyc_requested_tier = 2;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'user_profiles probe KYC submit reset: % row(s)', n;
  ELSE
    RAISE NOTICE 'user_profiles absent — skipped';
  END IF;

  -- KYC verification session 6271d0e2… created by lane-03 (checks cascade).
  IF to_regclass('public.verification_session') IS NOT NULL THEN
    DELETE FROM public.verification_session
     WHERE id::text LIKE '6271d0e2%'
       AND user_id = '648e1080-d66e-4e53-b8d8-72bc51acc3af';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'verification_session probe row deleted: %', n;
  ELSE
    RAISE NOTICE 'verification_session absent — skipped';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'probe cleanup section skipped: %', SQLERRM;
END $$;

-- ── 4. device_push_tokens: any 'e2e-' probe tokens on ysf ──────────────────
-- Broadens v1 §2 (explicit token list, wrong uuid) to the 'e2e-' prefix —
-- covers the original three fake tokens plus any written since.
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.device_push_tokens') IS NOT NULL THEN
    DELETE FROM public.device_push_tokens
     WHERE user_id = '648e1080-d66e-4e53-b8d8-72bc51acc3af'
       AND token LIKE 'e2e-%';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'device_push_tokens e2e-* probe tokens deleted: %', n;
  ELSE
    RAISE NOTICE 'device_push_tokens absent — skipped';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'probe cleanup section skipped: %', SQLERRM;
END $$;

-- ── 5. mkt_trust_scores: forged marketplace badges on ysf (re-run of v1 §1) ─
-- The forged-boolean revert no-opped under '4e55'. The row itself is the
-- per-user trust profile (auto-materialised); the honest revert is to clear
-- the two forged booleans, not delete the row.
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.mkt_trust_scores') IS NOT NULL THEN
    UPDATE public.mkt_trust_scores
       SET verified_id_badge = false,
           verified_business_badge = false,
           updated_at = now()
     WHERE user_id = '648e1080-d66e-4e53-b8d8-72bc51acc3af'
       AND (verified_id_badge OR verified_business_badge);
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'mkt_trust_scores forged badges cleared: % row(s)', n;
  ELSE
    RAISE NOTICE 'mkt_trust_scores absent — skipped';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'probe cleanup section skipped: %', SQLERRM;
END $$;

-- ── 6. profiles: complete-profile probe rows on ysf (re-run of v1 §3) ──────
-- v1 scoped user_id='4e55' → zero rows. Same predicate, corrected uuid.
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    DELETE FROM public.profiles
     WHERE user_id = '648e1080-d66e-4e53-b8d8-72bc51acc3af'
       AND profile_type IN ('general','school_representative','sme_founder',
                            'football_talent','parent_guardian','actor','artist')
       AND created_at >= '2026-10-05'::timestamptz;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'profiles probe rows deleted: %', n;
  ELSE
    RAISE NOTICE 'profiles absent — skipped';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'probe cleanup section skipped: %', SQLERRM;
END $$;

-- ── 7. groups: 1f790405… M06 probe group on ysf (re-run of v1 §4) ──────────
-- Only the '1f790405%' predicate carried the wrong uuid; the a60d5b61 (ayaa)
-- and 4e345a66 (name-marker) groups were already handled by v1. Ledger-aware:
-- a group referenced by ledger_accounts is renamed, not deleted.
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.groups') IS NOT NULL THEN
    IF to_regclass('public.group_payments') IS NOT NULL THEN
      DELETE FROM public.group_payments
       WHERE group_id IN (
         SELECT id FROM public.groups
          WHERE id::text LIKE '1f790405%'
            AND created_by = '648e1080-d66e-4e53-b8d8-72bc51acc3af');
      GET DIAGNOSTICS n = ROW_COUNT;
      RAISE NOTICE 'group_payments on probe group deleted: %', n;
    END IF;
    IF to_regclass('public.ledger_accounts') IS NOT NULL THEN
      DELETE FROM public.groups g
       WHERE g.id::text LIKE '1f790405%'
         AND g.created_by = '648e1080-d66e-4e53-b8d8-72bc51acc3af'
         AND NOT EXISTS (SELECT 1 FROM public.ledger_accounts la
                          WHERE la.group_id = g.id);
      GET DIAGNOSTICS n = ROW_COUNT;
      RAISE NOTICE 'groups probe rows deleted: %', n;
      UPDATE public.groups g
         SET name = '[archived probe residue]'
       WHERE g.id::text LIKE '1f790405%'
         AND g.created_by = '648e1080-d66e-4e53-b8d8-72bc51acc3af'
         AND EXISTS (SELECT 1 FROM public.ledger_accounts la
                      WHERE la.group_id = g.id);
      GET DIAGNOSTICS n = ROW_COUNT;
      RAISE NOTICE 'groups probe rows neutralized (ledger-referenced): %', n;
    ELSE
      DELETE FROM public.groups
       WHERE id::text LIKE '1f790405%'
         AND created_by = '648e1080-d66e-4e53-b8d8-72bc51acc3af';
      GET DIAGNOSTICS n = ROW_COUNT;
      RAISE NOTICE 'groups probe rows deleted: %', n;
    END IF;
  ELSE
    RAISE NOTICE 'groups absent — skipped';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'probe cleanup section skipped: %', SQLERRM;
END $$;

-- ── 8. social: probe split / request / pool (re-run of v1 §5) ──────────────
-- All three parents were keyed on ysf '4e55' → zero rows; the child deletes
-- (split_shares, pool_contributions) sub-select the parent and so also
-- deleted nothing. Re-run entire section with '4e53'.
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.split_bills') IS NOT NULL THEN
    DELETE FROM public.split_shares
     WHERE split_id IN (SELECT id FROM public.split_bills
                         WHERE id::text LIKE 'a5653ac3%'
                           AND organiser_id = '648e1080-d66e-4e53-b8d8-72bc51acc3af');
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'split_shares on probe split deleted: %', n;
    DELETE FROM public.split_bills
     WHERE id::text LIKE 'a5653ac3%'
       AND organiser_id = '648e1080-d66e-4e53-b8d8-72bc51acc3af'
       AND state = 'OPEN';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'split_bills probe split deleted: %', n;
  ELSE
    RAISE NOTICE 'split_bills absent — skipped';
  END IF;

  IF to_regclass('public.social_requests') IS NOT NULL THEN
    DELETE FROM public.social_requests
     WHERE id::text LIKE '6f1ccc49%'
       AND requester_id = '648e1080-d66e-4e53-b8d8-72bc51acc3af'
       AND payer_id     = '00367732-a1f0-4bb0-b711-235facd82685'
       AND state = 'DECLINED';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'social_requests probe row deleted: %', n;
  ELSE
    RAISE NOTICE 'social_requests absent — skipped';
  END IF;

  IF to_regclass('public.group_pools') IS NOT NULL THEN
    DELETE FROM public.pool_contributions
     WHERE pool_id IN (SELECT id FROM public.group_pools
                        WHERE id::text LIKE 'a8c80910%'
                          AND organiser_id = '648e1080-d66e-4e53-b8d8-72bc51acc3af');
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'pool_contributions on probe pool deleted: %', n;
    DELETE FROM public.group_pools
     WHERE id::text LIKE 'a8c80910%'
       AND organiser_id = '648e1080-d66e-4e53-b8d8-72bc51acc3af'
       AND title = '' AND state = 'OPEN';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'group_pools probe row deleted: %', n;
  ELSE
    RAISE NOTICE 'group_pools absent — skipped';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'probe cleanup section skipped: %', SQLERRM;
END $$;

-- ── 9. connect: probe match + likes ysf↔ayaa (re-run of v1 §6) ─────────────
-- The match delete's endpoint check used '4e55' → match d21b957d… still
-- exists (its messages/conversations, keyed on match_id alone, already went
-- in v1 — re-run is an idempotent no-op). connect_likes also used '4e55'.
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.connect_matches') IS NOT NULL
     AND to_regclass('public.connect_profiles') IS NOT NULL THEN

    DELETE FROM public.connect_messages
     WHERE conversation_id IN (
       SELECT c.id FROM public.connect_conversations c
        WHERE c.match_id IN (SELECT id FROM public.connect_matches
                              WHERE id::text LIKE 'd21b957d%'));
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'connect_messages on probe match deleted: %', n;

    DELETE FROM public.connect_conversations
     WHERE match_id IN (SELECT id FROM public.connect_matches
                         WHERE id::text LIKE 'd21b957d%');
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'connect_conversations on probe match deleted: %', n;

    DELETE FROM public.connect_matches
     WHERE id::text LIKE 'd21b957d%'
       AND EXISTS (
         SELECT 1
           FROM public.connect_profiles pa
           JOIN public.connect_profiles pb ON pb.id = connect_matches.profile_b
          WHERE pa.id = connect_matches.profile_a
            AND pa.user_id = '648e1080-d66e-4e53-b8d8-72bc51acc3af'
            AND pb.user_id = '00367732-a1f0-4bb0-b711-235facd82685');
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'connect_matches probe row deleted: %', n;

    DELETE FROM public.connect_likes
     WHERE (from_profile, to_profile) IN (
       SELECT pa.id, pb.id
         FROM public.connect_profiles pa, public.connect_profiles pb
        WHERE (pa.user_id = '648e1080-d66e-4e53-b8d8-72bc51acc3af'
               AND pb.user_id = '00367732-a1f0-4bb0-b711-235facd82685')
           OR (pa.user_id = '00367732-a1f0-4bb0-b711-235facd82685'
               AND pb.user_id = '648e1080-d66e-4e53-b8d8-72bc51acc3af'));
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'connect_likes probe rows deleted: %', n;
  ELSE
    RAISE NOTICE 'connect matches/profiles absent — skipped';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'probe cleanup section skipped: %', SQLERRM;
END $$;

-- ── 10. savings: vault + circle + targets + autosave jobs (re-run of v1 §7) ─
-- Every predicate used '4e55' → all still live on prod. scheduler_jobs are
-- CANCELLED, not deleted (audit-friendly).
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.scheduler_jobs') IS NOT NULL THEN
    UPDATE public.scheduler_jobs
       SET status = 'cancelled', updated_at = now()
     WHERE owner_user_id = '648e1080-d66e-4e53-b8d8-72bc51acc3af'
       AND job_type = 'savings.autosave'
       AND status = 'active'
       AND (id::text LIKE 'ae44b669%' OR id::text LIKE 'f4569ce4%');
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'scheduler_jobs autosave jobs cancelled: %', n;
  ELSE
    RAISE NOTICE 'scheduler_jobs absent — skipped';
  END IF;

  IF to_regclass('public.savings_vaults') IS NOT NULL THEN
    DELETE FROM public.savings_vaults
     WHERE id = '67f2d219-9948-4823-9530-0c62f6e18060'
       AND owner_user_id = '648e1080-d66e-4e53-b8d8-72bc51acc3af'
       AND name = 'e2e' AND state = 'OPEN';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'savings_vaults probe vault deleted: %', n;
  ELSE
    RAISE NOTICE 'savings_vaults absent — skipped';
  END IF;

  IF to_regclass('public.ajo_circles') IS NOT NULL THEN
    DELETE FROM public.ajo_circles
     WHERE id = 'b77fbfd9-42e5-4d5c-a06f-4f851dea329c'
       AND creator_user_id = '648e1080-d66e-4e53-b8d8-72bc51acc3af'
       AND state = 'FORMING';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'ajo_circles probe circle deleted: %', n;
  ELSE
    RAISE NOTICE 'ajo_circles absent — skipped';
  END IF;

  IF to_regclass('public.group_targets') IS NOT NULL THEN
    DELETE FROM public.group_targets
     WHERE creator_user_id = '648e1080-d66e-4e53-b8d8-72bc51acc3af'
       AND state = 'OPEN'
       AND (id::text LIKE 'db03ac72%' OR id::text LIKE 'b5dd0be4%');
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'group_targets probe rows deleted: %', n;
  ELSE
    RAISE NOTICE 'group_targets absent — skipped';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'probe cleanup section skipped: %', SQLERRM;
END $$;

-- ── 11. utility: probe transactions + paystack intents (re-run of v1 §8) ────
-- Both predicates used '4e55' → zero rows. Corrected uuid.
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.utility_transactions') IS NOT NULL THEN
    DELETE FROM public.utility_transactions
     WHERE user_id = '648e1080-d66e-4e53-b8d8-72bc51acc3af'
       AND status IN ('initiated','failed','reversed')
       AND (id = '8965eb3c-13ae-4c48-8c1e-226296ac95dd'
            OR id::text LIKE 'e605c527%');
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'utility_transactions probe rows deleted: %', n;
  ELSE
    RAISE NOTICE 'utility_transactions absent — skipped';
  END IF;

  IF to_regclass('public.utility_paystack_intents') IS NOT NULL THEN
    DELETE FROM public.utility_paystack_intents
     WHERE user_id = '648e1080-d66e-4e53-b8d8-72bc51acc3af'
       AND status IN ('pending','failed')
       AND payment_reference IN ('UTIL_E1B0D2D9F8634A90A3',
                                 'UTIL_DF26F2CEC3104457BB');
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'utility_paystack_intents probe rows deleted: %', n;
  ELSE
    RAISE NOTICE 'utility_paystack_intents absent — skipped';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'probe cleanup section skipped: %', SQLERRM;
END $$;

-- ── 12. academy_application_fee_intents (partial re-run of v1 §9) ──────────
-- The exact 'academy-fee-1d623ba2-…' reference was uuid-free and already
-- deleted by v1. Only the truncated 'academy-fee-78983012%' predicate used
-- '4e55' → re-run that one with '4e53'.
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.academy_application_fee_intents') IS NOT NULL THEN
    DELETE FROM public.academy_application_fee_intents
     WHERE status = 'pending'
       AND reference LIKE 'academy-fee-78983012%'
       AND user_id = '648e1080-d66e-4e53-b8d8-72bc51acc3af';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'academy_application_fee_intents probe rows deleted: %', n;
  ELSE
    RAISE NOTICE 'academy_application_fee_intents absent — skipped';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'probe cleanup section skipped: %', SQLERRM;
END $$;

-- ── 13. restaurant: probe group orders (re-run of v1 §10) ──────────────────
-- host_id '4e55' → zero rows (child items sub-select the parent, also zero).
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.group_orders') IS NOT NULL THEN
    DELETE FROM public.group_order_items
     WHERE group_id IN (SELECT id FROM public.group_orders
                         WHERE host_id = '648e1080-d66e-4e53-b8d8-72bc51acc3af'
                           AND status = 'open' AND order_id IS NULL
                           AND (id = '1aea1d67-0e61-4e9c-9eef-ce243fbdd81a'
                                OR id::text LIKE 'dfeb9ea9%'));
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'group_order_items on probe orders deleted: %', n;
    DELETE FROM public.group_orders
     WHERE host_id = '648e1080-d66e-4e53-b8d8-72bc51acc3af'
       AND status = 'open' AND order_id IS NULL
       AND (id = '1aea1d67-0e61-4e9c-9eef-ce243fbdd81a'
            OR id::text LIKE 'dfeb9ea9%');
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'group_orders probe rows deleted: %', n;
  ELSE
    RAISE NOTICE 'group_orders absent — skipped';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'probe cleanup section skipped: %', SQLERRM;
END $$;

-- ── 14. referrals: ysf→ayaa probe attribution (re-run of v1 §12) ────────────
-- referred_user_id '4e55' → zero rows. Both blocks re-run with '4e53';
-- beneficiary/referrer '00367732-…' (ayaa) was already correct.
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.referral_reward_ledger') IS NOT NULL THEN
    DELETE FROM public.referral_reward_ledger
     WHERE referred_user_id = '648e1080-d66e-4e53-b8d8-72bc51acc3af'
       AND beneficiary_id   = '00367732-a1f0-4bb0-b711-235facd82685'
       AND ledger_entry_id IS NULL;   -- never posted to the finance ledger
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'referral_reward_ledger probe accruals deleted: %', n;
  ELSE
    RAISE NOTICE 'referral_reward_ledger absent — skipped';
  END IF;

  IF to_regclass('public.referral_attributions') IS NOT NULL THEN
    DELETE FROM public.referral_attributions
     WHERE referred_user_id = '648e1080-d66e-4e53-b8d8-72bc51acc3af'
       AND referrer_id      = '00367732-a1f0-4bb0-b711-235facd82685'
       AND attribution_type = 'code'
       AND code_used = 'HCUPF';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'referral_attributions probe row deleted: %', n;
  ELSE
    RAISE NOTICE 'referral_attributions absent — skipped';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'probe cleanup section skipped: %', SQLERRM;
END $$;

-- ── 15. crowdfunding: probe support ticket SPL-TK-3269 (re-run of v1 §13) ───
-- user_id '4e55' → zero rows. Corrected uuid.
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.cf_support_tickets') IS NOT NULL THEN
    DELETE FROM public.cf_support_tickets
     WHERE reference = 'SPL-TK-3269'
       AND user_id = '648e1080-d66e-4e53-b8d8-72bc51acc3af'
       AND status = 'OPEN';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'cf_support_tickets probe row deleted: %', n;
  ELSE
    RAISE NOTICE 'cf_support_tickets absent — skipped';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'probe cleanup section skipped: %', SQLERRM;
END $$;

-- ── 16. registration draft SMEPIT-329713-TV8MFP (re-run of v1 §14) ──────────
-- The application delete used user_id '4e55' → draft still live. The
-- share_code 'UEGVPR9Q' delete was uuid-free and already ran under v1 —
-- re-run as a cheap idempotent companion.
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.contestant_share_links') IS NOT NULL THEN
    DELETE FROM public.contestant_share_links
     WHERE share_code = 'UEGVPR9Q';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'contestant_share_links probe row deleted: %', n;
  ELSE
    RAISE NOTICE 'contestant_share_links absent — skipped';
  END IF;

  IF to_regclass('public.contest_registration_applications') IS NOT NULL THEN
    DELETE FROM public.contest_registration_applications
     WHERE application_reference = 'SMEPIT-329713-TV8MFP'
       AND user_id = '648e1080-d66e-4e53-b8d8-72bc51acc3af'
       AND status = 'draft';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'contest_registration_applications probe draft deleted: %', n;
  ELSE
    RAISE NOTICE 'contest_registration_applications absent — skipped';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'probe cleanup section skipped: %', SQLERRM;
END $$;

COMMIT;
