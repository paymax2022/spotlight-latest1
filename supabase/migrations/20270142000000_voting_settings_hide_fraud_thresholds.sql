-- Anonymous readers must not see the anti-abuse thresholds.
--
-- voting_settings_public_read grants SELECT to PUBLIC on any row with
-- status = 'active', and `anon` holds a table-level SELECT grant. Those rows
-- carry the fraud configuration. Verified as the anon role before this
-- migration: 8 rows readable, exposing suspicious_ip_limit = 20,
-- bot_speed_threshold_ms = 500, max_failed_attempts = 10 — exactly the numbers
-- someone needs to stay under while stuffing votes.
--
-- The policy pre-dates this work, but 20270139000000 is what made it bite: it
-- backfilled the settings row every contest needs, taking the active count from
-- 1 to 8. Closing it here rather than leaving it as a side effect.
--
-- ⚠️ WHY NOT A COLUMN-LEVEL REVOKE. The obvious
--   REVOKE SELECT (suspicious_ip_limit, ...) ON voting_settings FROM anon
-- silently does NOTHING here, and psql reports success. A column-level REVOKE
-- cannot carve an exception out of a TABLE-level grant, and anon holds
-- GRANT SELECT on the whole table. Verified after trying it: anon still read
-- suspicious_ip_limit = 20. The table grant has to go first, and the safe
-- columns granted back explicitly.
--
-- Row-level security cannot express "these columns but not those", so column
-- grants are the only mechanism. service_role is untouched, and every reader of
-- these columns in the codebase (free-vote.service, visibility.service, the v1
-- contest routes, the admin settings route) goes through it.
--
-- Fail-closed by design: a column added to this table later is NOT granted to
-- anon until someone decides it is public. That is the right default for a table
-- holding anti-abuse configuration.
--
-- ⚠️ An anon/authenticated `SELECT *` now fails rather than silently omitting
-- columns. No such caller exists in this repo — every read is server-side with
-- the service-role client — but a future client-side reader must name columns.

DO $$
DECLARE
  v_cols TEXT;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'voting_settings'
     AND column_name NOT IN (
       'fraud_detection_enabled',
       'suspicious_ip_limit',
       'bot_speed_threshold_ms',
       'max_failed_attempts',
       'enable_vote_quarantine',
       'block_disposable_emails'
     );

  EXECUTE 'REVOKE SELECT ON public.voting_settings FROM anon, authenticated';
  EXECUTE format('GRANT SELECT (%s) ON public.voting_settings TO anon, authenticated', v_cols);
END;
$$;
