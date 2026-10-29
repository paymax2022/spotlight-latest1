-- Why did a referral code earn nothing on a referee's purchase?
-- Read-only. Run against the database the app was tested on:
--   psql "$DATABASE_URL" -v code=RCTNV -f diagnose-code.sql
-- Each block answers one link in the chain; the first one that comes back
-- empty or wrong is where the commission stopped.

\echo '1. Who owns the code? (referral_links first, then the legacy table)'
SELECT 'referral_links' AS src, referrer_id, code, reward_count, reward_cap,
       (reward_count >= reward_cap) AS retired
  FROM referral_links WHERE upper(code) = upper(:'code')
UNION ALL
SELECT 'finance_referral_codes', user_id, code, NULL, NULL, NULL
  FROM finance_referral_codes WHERE upper(code) = upper(:'code');

\echo '2. Who is attributed to that referrer? (empty = the referee never applied the code)'
SELECT a.referred_user_id, a.attribution_type, a.is_house, a.created_at, a.reassigned_at
  FROM referral_attributions a
 WHERE a.referrer_id IN (SELECT referrer_id FROM referral_links WHERE upper(code) = upper(:'code')
                         UNION SELECT user_id FROM finance_referral_codes WHERE upper(code) = upper(:'code'));

\echo '3. The referees'' utility purchases (status must be successful/provider_pending, not reversed/failed)'
SELECT t.id, t.user_id, t.category, t.amount_kobo, t.status, t.failure_reason, t.created_at
  FROM utility_transactions t
 WHERE t.user_id IN (SELECT a.referred_user_id FROM referral_attributions a
                      WHERE a.referrer_id IN (SELECT referrer_id FROM referral_links WHERE upper(code) = upper(:'code')))
 ORDER BY t.created_at DESC LIMIT 20;

\echo '4. Commission recorded for those purchases (spotlight_revenue_kobo must be > 0)'
SELECT ce.id, ce.source_module, ce.source_ref, ce.spotlight_revenue_kobo, ce.user_id, ce.created_at
  FROM commission_earnings ce
 WHERE ce.user_id IN (SELECT a.referred_user_id FROM referral_attributions a
                       WHERE a.referrer_id IN (SELECT referrer_id FROM referral_links WHERE upper(code) = upper(:'code')))
 ORDER BY ce.created_at DESC LIMIT 20;

\echo '5. The referrer''s reward rows (empty with rows in 4 = FEATURE_REFERRAL_COMMISSION_SPLIT_ENABLED is off)'
SELECT rr.source_transaction_id, rr.module, rr.reward_kobo, rr.status, rr.created_at
  FROM referral_rewards rr
 WHERE rr.referrer_id IN (SELECT referrer_id FROM referral_links WHERE upper(code) = upper(:'code'))
 ORDER BY rr.created_at DESC LIMIT 20;

\echo '6. Withdrawable balance (state eligible = shows under Ready to withdraw)'
SELECT state, count(*), sum(amount_kobo) AS kobo
  FROM referral_reward_ledger
 WHERE beneficiary_id IN (SELECT referrer_id FROM referral_links WHERE upper(code) = upper(:'code'))
 GROUP BY state;
