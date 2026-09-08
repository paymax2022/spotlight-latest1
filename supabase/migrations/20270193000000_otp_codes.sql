-- Server-issued email OTP: storage for codes and rate-limit counters.
--
-- WHY POSTGRES AND NOT REDIS
-- --------------------------
-- The implementation guide specifies Redis as the primary store. This codebase
-- cannot use it for this purpose: router.go constructs Redis best-effort and
-- states the rule explicitly — "Redis is a latency optimization, never a
-- correctness dependency" — and `sharedRedis` is nil whenever REDIS_URL is unset
-- or the connection fails. An OTP's single-use guarantee, attempt ceiling and
-- send budget are correctness, not latency: if the store vanishes, a code must
-- stop verifying, not start verifying freely. So the authoritative store is
-- Postgres, which is also where every other money-path invariant in this repo
-- lives.
--
-- Postgres has no TTL, so rows are swept opportunistically by the service (see
-- store_postgres.go DeleteExpired) as well as being expiry-checked on read.
-- Expiry is enforced at READ, never by the sweep alone — a sweep that has not
-- run yet must not make an expired code usable.
--
-- NO PII
-- ------
-- `key` is `purpose:HMAC(pepper, lowercased-email)`. The address itself is never
-- stored, so this table cannot leak a user list, and a dump without the pepper
-- cannot be correlated back to accounts.

CREATE TABLE IF NOT EXISTS public.otp_codes (
    key        TEXT PRIMARY KEY,
    -- HMAC-SHA256(pepper, code) as hex. The code itself is never stored: a plain
    -- SHA-256 of six digits is a one-million-entry rainbow table, and bcrypt is
    -- too slow for a verification path. See internal/otp/otp.go.
    code_hash  TEXT        NOT NULL,
    purpose    TEXT        NOT NULL,
    attempts   INT         NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- Drives both the opportunistic sweep and any operational cleanup.
CREATE INDEX IF NOT EXISTS otp_codes_expires_idx ON public.otp_codes (expires_at);

-- Fixed-window counters for send budgets and verify budgets. Separate from
-- otp_codes because a send limit has to survive the code being consumed or
-- deleted — otherwise a caller could reset their own budget by verifying.
CREATE TABLE IF NOT EXISTS public.otp_rate_limits (
    key          TEXT PRIMARY KEY,
    count        INT         NOT NULL DEFAULT 0 CHECK (count >= 0),
    window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS otp_rate_limits_expires_idx ON public.otp_rate_limits (expires_at);

-- Deny-by-default. Both tables are written only by the Go service through the
-- pgx pool (service role, which bypasses RLS). No policy is defined, so no
-- anon/authenticated PostgREST caller can read a hash or a counter.
ALTER TABLE public.otp_codes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_rate_limits ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.otp_codes IS
  'Server-issued email OTPs. key = purpose:HMAC(pepper,email); code_hash = HMAC(pepper,code). No plaintext code or address is stored.';
COMMENT ON TABLE public.otp_rate_limits IS
  'Fixed-window counters for OTP send/verify budgets, keyed by hashed identifier or hashed IP.';
