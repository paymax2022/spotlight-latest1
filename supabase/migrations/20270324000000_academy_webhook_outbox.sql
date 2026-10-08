-- academy_webhook_outbox — bounded retry queue for academy rail webhook settle
-- legs (AUD-BE-013 residual). A signed settle webhook consumes its dedupe key
-- in academy_rail_webhook_events and the obligation row is already terminal, so
-- when PostJournal then fails transiently the escrow→settlement leg was
-- permanently lost: the handler still acks 200 (provider stops retrying) and
-- the dedupe table swallows replays. This table parks the failed leg; the next
-- inbound webhook on the rail — including the provider's own retry, which hits
-- the dedupe path — redrives it. Bounded: attempts back off exponentially to a
-- 30-minute cap and the row parks 'exhausted' after 10 tries for manual repair.
--
-- Idempotency is preserved end-to-end: the row's idempotency_key is the SAME
-- deterministic key the original post used (academy-rail:<rail>:<ref>), so a
-- redrive that races a leg that actually landed is a ledger-level no-op
-- (ErrDuplicate ⇒ row flips 'posted').
--
-- amount_minor is a snapshot of the OWNING obligation row's committed amount at
-- failure time (never the wire's claimed amount). 0 means "no snapshot — the
-- obligation read itself failed"; redrive re-derives it from the row.
CREATE TABLE IF NOT EXISTS public.academy_webhook_outbox (
    id              UUID        NOT NULL DEFAULT gen_random_uuid(),
    rail            TEXT        NOT NULL,
    provider_ref    TEXT        NOT NULL,
    reference       TEXT        NOT NULL DEFAULT '',
    amount_minor    BIGINT      NOT NULL DEFAULT 0,
    idempotency_key TEXT        NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'posted', 'exhausted')),
    attempts        INT         NOT NULL DEFAULT 0,
    next_retry_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (rail, provider_ref)
);

-- Partial index: only pending rows are ever swept, keyed by rail + due time.
CREATE INDEX IF NOT EXISTS academy_webhook_outbox_due_idx
    ON public.academy_webhook_outbox (rail, next_retry_at)
    WHERE status = 'pending';

-- Deny-all RLS (rls-check gate): backend-only table — no client reads it, and
-- the Go service connects as the table owner over pgx, which bypasses RLS.
ALTER TABLE public.academy_webhook_outbox ENABLE ROW LEVEL SECURITY;
