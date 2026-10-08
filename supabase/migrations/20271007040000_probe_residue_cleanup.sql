-- ============================================================================
-- probe_residue_cleanup — one-off DATA cleanup of E2E probe residue on prod.
--
-- Scope: every statement is scoped to explicit ids/uuids (or unique codes)
-- taken verbatim from the wave-5/6 lane reports under /tmp/e2e-fix1 and
-- /tmp/e2e-fix2 (agent-01..15, v1..v7 verify). No broad patterns; uuid
-- prefixes are used ONLY where the lane report logged a truncated id, and
-- always AND-ed with the owning fixture user + a status/marker predicate.
--
-- Fixture accounts:
--   ysf  = 648e1080-d66e-4e55-b8d8-72bc51acc3af  (ysfakinleye@gmail.com)
--   ayaa = 00367732-a1f0-4bb0-b711-235facd82685  (ayaaakinleye, backup)
--   probe throwaway = b4c78497-16af-43e1-8327-bdcb245a780b
--                     (e2e-probe-1791326575@example.invalid, unverified)
--
-- Safety notes:
--   * Each block is guarded by to_regclass() so prod schema drift cannot
--     abort the run mid-file.
--   * No money-path tables are touched: nothing here writes ledger_entries,
--     wallets, escrow_holds or any balance column. Deletes target only
--     probe rows that never moved real money (all debits were refused at
--     tier/balance gates — verified per lane reports).
--   * scheduler_jobs rows are CANCELLED, not deleted, matching the app fix
--     (savings autosave replace now cancels the prior job).
--   * Consent/audit rows (kyc_events, health_consents, kyc_consent,
--     insurance_consent, stays_consent) are deliberately LEFT in place —
--     they are append-only compliance records by design; see lane report.
-- ============================================================================

BEGIN;

-- ── 1. mkt_trust_scores: forged marketplace badges on ysf ────────────────────
-- Forged via the pre-fix badge-forgery bug (wave-5 item 1). The row itself is
-- the per-user trust profile (auto-materialised); the honest revert is to
-- clear the two forged booleans, not delete the row.
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.mkt_trust_scores') IS NOT NULL THEN
    UPDATE public.mkt_trust_scores
       SET verified_id_badge = false,
           verified_business_badge = false,
           updated_at = now()
     WHERE user_id = '648e1080-d66e-4e55-b8d8-72bc51acc3af'
       AND (verified_id_badge OR verified_business_badge);
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'mkt_trust_scores forged badges cleared: % row(s)', n;
  ELSE
    RAISE NOTICE 'mkt_trust_scores absent — skipped';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'probe cleanup section skipped: %', SQLERRM;
END $$;

-- ── 2. device_push_tokens: fake probe tokens on ysf ─────────────────────────
-- Three confirmed 204 writes: lane-01 'e2e-probe-auth-lane-01-fake-token',
-- lane-15 'e2e-probe-fake-fcm-token-abc123', v4-verify 'e2e-v4-verify-fake-token'.
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.device_push_tokens') IS NOT NULL THEN
    DELETE FROM public.device_push_tokens
     WHERE user_id = '648e1080-d66e-4e55-b8d8-72bc51acc3af'
       AND token IN ('e2e-probe-auth-lane-01-fake-token',
                     'e2e-probe-fake-fcm-token-abc123',
                     'e2e-v4-verify-fake-token');
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'device_push_tokens probe tokens deleted: %', n;
  ELSE
    RAISE NOTICE 'device_push_tokens absent — skipped';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'probe cleanup section skipped: %', SQLERRM;
END $$;

-- ── 3. profiles: complete-profile probe rows on ysf ─────────────────────────
-- v1-verify/lane-01: created via POST /api/auth/complete-profile during probes
-- (incl. profileType 'artist' with metadata.bio = e2e-probe). Time-bounded to
-- the probe window so any pre-existing row survives.
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    DELETE FROM public.profiles
     WHERE user_id = '648e1080-d66e-4e55-b8d8-72bc51acc3af'
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

-- ── 4. groups: probe groups ──────────────────────────────────────────────────
-- a60d5b61 'E2E IDOR probe (delete-me)' (ayaa, wave-5 v2)
-- 4e345a66-3594-4bf6-ace2-3551a283f25c earlier "delete-me" probe group
-- 1f790405… M06 probe group (ysf) — truncated id in lane-06 report
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.groups') IS NOT NULL THEN
    IF to_regclass('public.group_payments') IS NOT NULL THEN
      DELETE FROM public.group_payments
       WHERE group_id IN (
         SELECT id FROM public.groups
          WHERE (id = 'a60d5b61-5ce7-45fc-9430-f8b323aa4fb0'
                 AND created_by = '00367732-a1f0-4bb0-b711-235facd82685')
             OR (id = '4e345a66-3594-4bf6-ace2-3551a283f25c'
                 AND (name ILIKE '%delete%' OR name ILIKE '%probe%' OR name ILIKE '%e2e%'))
             OR (id::text LIKE '1f790405%'
                 AND created_by = '648e1080-d66e-4e55-b8d8-72bc51acc3af'));
      GET DIAGNOSTICS n = ROW_COUNT;
      RAISE NOTICE 'group_payments on probe groups deleted: %', n;
    END IF;
    -- Groups referenced by ledger_accounts cannot be deleted (FK +
    -- immutable-ledger rule); neutralize those by renaming, delete the rest.
    IF to_regclass('public.ledger_accounts') IS NOT NULL THEN
      DELETE FROM public.groups g
       WHERE ((g.id = 'a60d5b61-5ce7-45fc-9430-f8b323aa4fb0'
               AND g.created_by = '00367732-a1f0-4bb0-b711-235facd82685')
          OR (g.id = '4e345a66-3594-4bf6-ace2-3551a283f25c'
               AND (g.name ILIKE '%delete%' OR g.name ILIKE '%probe%' OR g.name ILIKE '%e2e%'))
          OR (g.id::text LIKE '1f790405%'
               AND g.created_by = '648e1080-d66e-4e55-b8d8-72bc51acc3af'))
         AND NOT EXISTS (SELECT 1 FROM public.ledger_accounts la
                          WHERE la.group_id = g.id);
      GET DIAGNOSTICS n = ROW_COUNT;
      RAISE NOTICE 'groups probe rows deleted: %', n;
      UPDATE public.groups g
         SET name = '[archived probe residue]'
       WHERE ((g.id = 'a60d5b61-5ce7-45fc-9430-f8b323aa4fb0'
               AND g.created_by = '00367732-a1f0-4bb0-b711-235facd82685')
          OR (g.id = '4e345a66-3594-4bf6-ace2-3551a283f25c'
               AND (g.name ILIKE '%delete%' OR g.name ILIKE '%probe%' OR g.name ILIKE '%e2e%'))
          OR (g.id::text LIKE '1f790405%'
               AND g.created_by = '648e1080-d66e-4e55-b8d8-72bc51acc3af'))
         AND EXISTS (SELECT 1 FROM public.ledger_accounts la
                      WHERE la.group_id = g.id);
      GET DIAGNOSTICS n = ROW_COUNT;
      RAISE NOTICE 'groups probe rows neutralized (ledger-referenced): %', n;
    ELSE
      DELETE FROM public.groups
       WHERE (id = 'a60d5b61-5ce7-45fc-9430-f8b323aa4fb0'
              AND created_by = '00367732-a1f0-4bb0-b711-235facd82685')
          OR (id = '4e345a66-3594-4bf6-ace2-3551a283f25c'
              AND (name ILIKE '%delete%' OR name ILIKE '%probe%' OR name ILIKE '%e2e%'))
          OR (id::text LIKE '1f790405%'
              AND created_by = '648e1080-d66e-4e55-b8d8-72bc51acc3af');
      GET DIAGNOSTICS n = ROW_COUNT;
      RAISE NOTICE 'groups probe rows deleted: %', n;
    END IF;
  ELSE
    RAISE NOTICE 'groups absent — skipped';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'probe cleanup section skipped: %', SQLERRM;
END $$;

-- ── 5. social: probe split / request / pool ─────────────────────────────────
-- split  a5653ac3… (ysf organiser, ayaa share PENDING — never paid)
-- request 6f1ccc49… (ysf→ayaa, DECLINED)
-- pool   a8c80910… (ysf, empty title — the create-pool bug artifact)
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.split_bills') IS NOT NULL THEN
    DELETE FROM public.split_shares
     WHERE split_id IN (SELECT id FROM public.split_bills
                         WHERE id::text LIKE 'a5653ac3%'
                           AND organiser_id = '648e1080-d66e-4e55-b8d8-72bc51acc3af');
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'split_shares on probe split deleted: %', n;
    DELETE FROM public.split_bills
     WHERE id::text LIKE 'a5653ac3%'
       AND organiser_id = '648e1080-d66e-4e55-b8d8-72bc51acc3af'
       AND state = 'OPEN';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'split_bills probe split deleted: %', n;
  ELSE
    RAISE NOTICE 'split_bills absent — skipped';
  END IF;

  IF to_regclass('public.social_requests') IS NOT NULL THEN
    DELETE FROM public.social_requests
     WHERE id::text LIKE '6f1ccc49%'
       AND requester_id = '648e1080-d66e-4e55-b8d8-72bc51acc3af'
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
                          AND organiser_id = '648e1080-d66e-4e55-b8d8-72bc51acc3af');
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'pool_contributions on probe pool deleted: %', n;
    DELETE FROM public.group_pools
     WHERE id::text LIKE 'a8c80910%'
       AND organiser_id = '648e1080-d66e-4e55-b8d8-72bc51acc3af'
       AND title = '' AND state = 'OPEN';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'group_pools probe row deleted: %', n;
  ELSE
    RAISE NOTICE 'group_pools absent — skipped';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'probe cleanup section skipped: %', SQLERRM;
END $$;

-- ── 6. connect: probe match + conversation + likes (ysf↔ayaa) ───────────────
-- match d21b957d… created by lane-06 mutual-like round trip. Guarded so the
-- match is only removed when its two endpoints ARE the two fixture profiles.
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
            AND pa.user_id = '648e1080-d66e-4e55-b8d8-72bc51acc3af'
            AND pb.user_id = '00367732-a1f0-4bb0-b711-235facd82685');
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'connect_matches probe row deleted: %', n;

    DELETE FROM public.connect_likes
     WHERE (from_profile, to_profile) IN (
       SELECT pa.id, pb.id
         FROM public.connect_profiles pa, public.connect_profiles pb
        WHERE (pa.user_id = '648e1080-d66e-4e55-b8d8-72bc51acc3af'
               AND pb.user_id = '00367732-a1f0-4bb0-b711-235facd82685')
           OR (pa.user_id = '00367732-a1f0-4bb0-b711-235facd82685'
               AND pb.user_id = '648e1080-d66e-4e55-b8d8-72bc51acc3af'));
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'connect_likes probe rows deleted: %', n;
  ELSE
    RAISE NOTICE 'connect matches/profiles absent — skipped';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'probe cleanup section skipped: %', SQLERRM;
END $$;

-- ── 7. savings: vault + circle + targets + orphan autosave jobs ──────────────
-- vault  67f2d219-9948-4823-9530-0c62f6e18060 "e2e" FLEX (ysf)
-- circle b77fbfd9-42e5-4d5c-a06f-4f851dea329c FORMING (ysf)
-- targets db03ac72… / b5dd0be4… OPEN (ysf)
-- scheduler jobs ae44b669… (orphaned prior autosave) + f4569ce4… (current
--   autosave for the deleted vault) → CANCELLED, not deleted (audit-friendly).
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.scheduler_jobs') IS NOT NULL THEN
    UPDATE public.scheduler_jobs
       SET status = 'cancelled', updated_at = now()
     WHERE owner_user_id = '648e1080-d66e-4e55-b8d8-72bc51acc3af'
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
       AND owner_user_id = '648e1080-d66e-4e55-b8d8-72bc51acc3af'
       AND name = 'e2e' AND state = 'OPEN';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'savings_vaults probe vault deleted: %', n;
  ELSE
    RAISE NOTICE 'savings_vaults absent — skipped';
  END IF;

  IF to_regclass('public.ajo_circles') IS NOT NULL THEN
    DELETE FROM public.ajo_circles
     WHERE id = 'b77fbfd9-42e5-4d5c-a06f-4f851dea329c'
       AND creator_user_id = '648e1080-d66e-4e55-b8d8-72bc51acc3af'
       AND state = 'FORMING';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'ajo_circles probe circle deleted: %', n;
  ELSE
    RAISE NOTICE 'ajo_circles absent — skipped';
  END IF;

  IF to_regclass('public.group_targets') IS NOT NULL THEN
    DELETE FROM public.group_targets
     WHERE creator_user_id = '648e1080-d66e-4e55-b8d8-72bc51acc3af'
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

-- ── 8. utility: failed/stuck probe transactions + dead paystack intents ─────
-- tx e605c527… (phantom 'initiated' pre-fix; since swept to 'failed')
-- tx 8965eb3c-13ae-4c48-8c1e-226296ac95dd (402 refusal → 'failed')
-- intents UTIL_E1B0D2D9F8634A90A3, UTIL_DF26F2CEC3104457BB (never charged)
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.utility_transactions') IS NOT NULL THEN
    DELETE FROM public.utility_transactions
     WHERE user_id = '648e1080-d66e-4e55-b8d8-72bc51acc3af'
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
     WHERE user_id = '648e1080-d66e-4e55-b8d8-72bc51acc3af'
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

-- ── 9. academy_application_fee_intents: unpaid probe intents ────────────────
-- 'academy-fee-1d623ba2-1988-4234-bfb4-6d09c217bc75' (lane-05) and
-- 'academy-fee-78983012…' (lane-14, truncated). Pending, never paid.
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.academy_application_fee_intents') IS NOT NULL THEN
    DELETE FROM public.academy_application_fee_intents
     WHERE status = 'pending'
       AND (reference = 'academy-fee-1d623ba2-1988-4234-bfb4-6d09c217bc75'
            OR (reference LIKE 'academy-fee-78983012%'
                AND user_id = '648e1080-d66e-4e55-b8d8-72bc51acc3af'));
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'academy_application_fee_intents probe rows deleted: %', n;
  ELSE
    RAISE NOTICE 'academy_application_fee_intents absent — skipped';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'probe cleanup section skipped: %', SQLERRM;
END $$;

-- ── 10. restaurant: probe group orders on the closed test store ─────────────
-- group_orders 1aea1d67-0e61-4e9c-9eef-ce243fbdd81a + dfeb9ea9… (ysf host,
-- open, never finalized — no order_id, no escrow).
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.group_orders') IS NOT NULL THEN
    DELETE FROM public.group_order_items
     WHERE group_id IN (SELECT id FROM public.group_orders
                         WHERE host_id = '648e1080-d66e-4e55-b8d8-72bc51acc3af'
                           AND status = 'open' AND order_id IS NULL
                           AND (id = '1aea1d67-0e61-4e9c-9eef-ce243fbdd81a'
                                OR id::text LIKE 'dfeb9ea9%'));
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'group_order_items on probe orders deleted: %', n;
    DELETE FROM public.group_orders
     WHERE host_id = '648e1080-d66e-4e55-b8d8-72bc51acc3af'
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

-- ── 11. KYC: reset ysf's probe tier-2 submission ────────────────────────────
-- v4-verify's POST /api/v1/kyc/tier2 left kyc_status='pending',
-- kyc_requested_tier=2. Pre-submit state was tier-0 'unverified' — restore it.
-- document_ref is cleared only when it carries a probe marker; kyc_events rows
-- are LEFT as the audit trail of the probe.
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
               OR document_ref ILIKE '%probe%'
               OR document_ref ILIKE '%example.com%' THEN NULL
             ELSE document_ref END,
           updated_at = now()
     WHERE id = '648e1080-d66e-4e55-b8d8-72bc51acc3af'
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
       AND user_id = '648e1080-d66e-4e55-b8d8-72bc51acc3af';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'verification_session probe row deleted: %', n;
  ELSE
    RAISE NOTICE 'verification_session absent — skipped';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'probe cleanup section skipped: %', SQLERRM;
END $$;

-- ── 12. referrals: ysf→ayaa probe attribution ───────────────────────────────
-- lane-09 happy-path probe attributed ysf to ayaa's engine code HCUPF.
-- Remove notional reward accruals minted by that attribution, then the row.
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.referral_reward_ledger') IS NOT NULL THEN
    DELETE FROM public.referral_reward_ledger
     WHERE referred_user_id = '648e1080-d66e-4e55-b8d8-72bc51acc3af'
       AND beneficiary_id   = '00367732-a1f0-4bb0-b711-235facd82685'
       AND ledger_entry_id IS NULL;   -- never posted to the finance ledger
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'referral_reward_ledger probe accruals deleted: %', n;
  ELSE
    RAISE NOTICE 'referral_reward_ledger absent — skipped';
  END IF;

  IF to_regclass('public.referral_attributions') IS NOT NULL THEN
    DELETE FROM public.referral_attributions
     WHERE referred_user_id = '648e1080-d66e-4e55-b8d8-72bc51acc3af'
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

-- ── 13. crowdfunding: probe support ticket SPL-TK-3269 ──────────────────────
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.cf_support_tickets') IS NOT NULL THEN
    DELETE FROM public.cf_support_tickets
     WHERE reference = 'SPL-TK-3269'
       AND user_id = '648e1080-d66e-4e55-b8d8-72bc51acc3af'
       AND status = 'OPEN';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'cf_support_tickets probe row deleted: %', n;
  ELSE
    RAISE NOTICE 'cf_support_tickets absent — skipped';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'probe cleanup section skipped: %', SQLERRM;
END $$;

-- ── 14. registration draft SMEPIT-329713-TV8MFP + its share link ────────────
-- Probe-created draft application (ysf). Child rows cascade; the unique
-- share_code UEGVPR9Q row on contestant_share_links is probe residue too.
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
       AND user_id = '648e1080-d66e-4e55-b8d8-72bc51acc3af'
       AND status = 'draft';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'contest_registration_applications probe draft deleted: %', n;
  ELSE
    RAISE NOTICE 'contest_registration_applications absent — skipped';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'probe cleanup section skipped: %', SQLERRM;
END $$;

-- ── 15. probe throwaway auth account ────────────────────────────────────────
-- b4c78497 / e2e-probe-1791326575@example.invalid — unverified register probe;
-- has NO platform_users mirror (the P0 bridge-drift symptom). Any surviving
-- children cascade; if a FK blocks the delete we skip rather than abort.
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.platform_users') IS NOT NULL THEN
    DELETE FROM public.platform_users
     WHERE id = 'b4c78497-16af-43e1-8327-bdcb245a780b';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'platform_users probe row deleted: %', n;
  END IF;

  BEGIN
    DELETE FROM auth.users
     WHERE id = 'b4c78497-16af-43e1-8327-bdcb245a780b'
       AND email = 'e2e-probe-1791326575@example.invalid';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'auth.users probe account deleted: %', n;
  EXCEPTION WHEN foreign_key_violation OR others THEN
    RAISE NOTICE 'auth.users probe account delete skipped: %', SQLERRM;
  END;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'probe cleanup section skipped: %', SQLERRM;
END $$;

COMMIT;
