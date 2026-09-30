-- academy_rail_webhook_events — dedupe store for inbound academy rail webhooks
-- (bnpl/payout/disburse/billing). The backend previously relied on runtime DDL
-- in newAcademyWebhookHandler whose error was swallowed, so environments could
-- run without the table and every webhook would 500 on dedupe with no signal.
-- Runtime DDL is kept as a fallback; this migration is the authoritative copy.
CREATE TABLE IF NOT EXISTS public.academy_rail_webhook_events (
    rail            TEXT        NOT NULL,
    provider_ref    TEXT        NOT NULL,
    idempotency_key TEXT        NOT NULL,
    reference       TEXT        NOT NULL,
    event           TEXT        NOT NULL,
    amount_minor    BIGINT      NOT NULL,
    processed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (rail, provider_ref)
);
