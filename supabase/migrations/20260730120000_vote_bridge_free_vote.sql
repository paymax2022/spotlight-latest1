-- Vote-bridge: atomic free-vote claim + idempotency store.
-- Additive-only. No DROP TABLE/COLUMN/TYPE, no RENAME, no type narrowing.
--
-- Fixes (for the bridged /api/v2/votes/free path only; the legacy path is
-- untouched and remains behind its own route):
--   D-002 — the per-contestant daily cap was claimed via a non-atomic
--           upsert→select→…→update (TOCTOU): two concurrent votes both read
--           used=0 and double-count. Here the claim is serialized with a
--           row lock (SELECT … FOR UPDATE), so exactly one over-cap vote wins.
--   D-003 — vote_totals for the free path is written with an atomic,
--           NULL-round-correct upsert (IS NOT DISTINCT FROM + advisory lock),
--           avoiding both the TS read-modify-write fallback AND the latent
--           fragmentation where ON CONFLICT (…, round_id) never matches a NULL
--           round and inserts duplicate totals rows.
-- The timezone-correct p_vote_date is computed by the bridge
-- (src/server/voting-bridge/vote-window.ts) and passed in — that fixes D-001.

-- ── Idempotency store for bridge vote calls ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bridge_idempotency_keys (
  key          text        PRIMARY KEY,
  response     jsonb       NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.bridge_idempotency_keys IS
  'Dedup store for bridge vote calls. TTL enforced by application sweep (24h).';

ALTER TABLE public.bridge_idempotency_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bridge_idempotency_keys_service_role" ON public.bridge_idempotency_keys;
CREATE POLICY "bridge_idempotency_keys_service_role"
  ON public.bridge_idempotency_keys FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── Atomic free-vote claim ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_free_vote(
  p_contest_id     uuid,
  p_contestant_id  uuid,
  p_voter          text,
  p_voter_type     text,
  p_vote_date      date,
  p_cap            integer,
  p_qty            integer,
  p_round_id       uuid    DEFAULT NULL,
  p_vote_status    text    DEFAULT 'confirmed',
  p_fraud_score    integer DEFAULT 0,
  p_fraud_status   text    DEFAULT 'clean',
  p_ip             inet    DEFAULT NULL,
  p_device         text    DEFAULT NULL,
  p_user_agent     text    DEFAULT NULL,
  p_share_code     text    DEFAULT NULL,
  p_voter_user_id  uuid    DEFAULT NULL,
  p_source         text    DEFAULT 'web'
)
RETURNS TABLE (granted integer, total_used integer, cap integer, vote_id uuid, vote_status text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_used    integer;
  v_limit   integer;
  v_granted integer;
  v_vote_id uuid;
BEGIN
  IF p_qty < 1 THEN
    RAISE EXCEPTION 'quantity must be >= 1' USING ERRCODE = '22023';
  END IF;

  -- 1) Ensure the per-(contest,contestant,voter,day) cap row exists.
  INSERT INTO public.voter_contestant_daily_limits (
    contest_id, contestant_id, voter_identifier, voter_identifier_type,
    vote_date, free_votes_used, free_votes_limit
  )
  VALUES (
    p_contest_id, p_contestant_id, p_voter, p_voter_type,
    p_vote_date, 0, p_cap
  )
  ON CONFLICT (contest_id, contestant_id, voter_identifier, voter_identifier_type, vote_date)
  DO NOTHING;

  -- 2) Lock the cap row so concurrent claims serialize here (fixes D-002 TOCTOU).
  SELECT free_votes_used, free_votes_limit
    INTO v_used, v_limit
  FROM public.voter_contestant_daily_limits
  WHERE contest_id = p_contest_id
    AND contestant_id = p_contestant_id
    AND voter_identifier = p_voter
    AND voter_identifier_type = p_voter_type
    AND vote_date = p_vote_date
  FOR UPDATE;

  v_granted := GREATEST(0, LEAST(p_qty, v_limit - v_used));

  IF v_granted = 0 THEN
    -- Cap already reached today; grant nothing, insert no vote.
    RETURN QUERY SELECT 0, v_used, v_limit, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- 3) Insert the append-only vote row.
  INSERT INTO public.votes (
    contest_id, contestant_id, voter_user_id, vote_type, vote_quantity,
    vote_status, round_id, ip_address, device_fingerprint, user_agent,
    source, share_code, fraud_score, fraud_status, confirmed_at
  )
  VALUES (
    p_contest_id, p_contestant_id, p_voter_user_id, 'free', v_granted,
    p_vote_status, p_round_id, p_ip, p_device, p_user_agent,
    p_source, p_share_code, p_fraud_score, p_fraud_status,
    CASE WHEN p_vote_status = 'confirmed' THEN now() ELSE NULL END
  )
  RETURNING id INTO v_vote_id;

  -- 4) Advance the cap counter (still under the row lock from step 2).
  UPDATE public.voter_contestant_daily_limits
     SET free_votes_used = v_used + v_granted,
         last_vote_at = now(),
         updated_at = now()
  WHERE contest_id = p_contest_id
    AND contestant_id = p_contestant_id
    AND voter_identifier = p_voter
    AND voter_identifier_type = p_voter_type
    AND vote_date = p_vote_date;

  -- 5) Totals projection — only for confirmed votes, NULL-round-correct.
  --    Advisory xact lock serializes the upsert per (contest,contestant) so the
  --    UPDATE-then-INSERT can't race into duplicate rows.
  IF p_vote_status = 'confirmed' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_contest_id::text || ':' || p_contestant_id::text, 0)
    );

    UPDATE public.vote_totals
       SET free_votes = free_votes + v_granted,
           total_confirmed_votes = total_confirmed_votes + v_granted,
           last_vote_at = now(),
           updated_at = now()
    WHERE contest_id = p_contest_id
      AND contestant_id = p_contestant_id
      AND round_id IS NOT DISTINCT FROM p_round_id;

    IF NOT FOUND THEN
      INSERT INTO public.vote_totals (
        contest_id, contestant_id, round_id,
        free_votes, total_confirmed_votes, last_vote_at
      )
      VALUES (
        p_contest_id, p_contestant_id, p_round_id,
        v_granted, v_granted, now()
      );
    END IF;
  END IF;

  RETURN QUERY SELECT v_granted, v_used + v_granted, v_limit, v_vote_id, p_vote_status;
END;
$$;

COMMENT ON FUNCTION public.claim_free_vote IS
  'Atomic free-vote claim used by the voting-bridge (/api/v2/votes/free). Row-locks the '
  'per-contestant daily cap to prevent double-count (D-002); NULL-round-correct atomic totals '
  'upsert (D-003). Timezone-correct p_vote_date is supplied by the bridge (D-001).';
