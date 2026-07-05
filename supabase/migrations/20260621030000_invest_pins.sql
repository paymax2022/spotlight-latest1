-- ── Paymax Invest — transaction PIN ──────────────────────────────────────────
-- Additive-only. Stores a salted SHA-256 PIN hash per user (raw PIN never
-- stored) plus failed-attempt lockout state. The PIN gates order confirmation
-- (iron rule: every order requires PIN/biometric).

CREATE TABLE IF NOT EXISTS invest_user_pins (
    user_id         text PRIMARY KEY,
    pin_hash        text NOT NULL,           -- hex sha256(salt || pin)
    salt            text NOT NULL,           -- per-user random salt (hex)
    failed_attempts int  NOT NULL DEFAULT 0,
    locked_until    timestamptz,             -- set after too many failures
    updated_at      timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now()
);
