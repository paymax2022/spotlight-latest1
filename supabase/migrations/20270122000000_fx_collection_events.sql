-- ── FX inbound collections: persist deposits and let them credit the wallet ──
-- Additive-only. Closes the last link of the collections rail: Maplerad/Eversend
-- provision a virtual account / IBAN (orch_collections, written by
-- Service.CreateCollection), the signed webhook endpoint already exists, but
-- Service.HandleProviderEvent only mapped transfer/conversion STATUS — so an
-- inbound deposit was signature-checked, acknowledged 200, and then dropped.
-- collection_store.go said so in its own comment: "Collection EVENTS ... have no
-- persistence yet — no provider collection feed is wired."
--
-- Two things are added:
--   1. orch_collections.provider_ref — the provider's own handle for the account
--      (for Maplerad, the virtual account number). It was already being returned
--      as CollectionResult.ProviderRef and then DISCARDED by CreateCollection,
--      leaving `details->>'account_number'` as the only way to match a webhook
--      back to a customer. A jsonb key is not a join key.
--   2. orch_collection_events — one immutable row per credited deposit, and the
--      idempotency record that makes a replayed webhook a no-op.
--
-- IRON RULES honoured: integer minor units (amount_minor bigint, CHECK > 0);
-- additive-only (no DROP, no rename, no type narrowing); the credit itself is
-- double-entry and posts through the same pot selector as every other FX money
-- path (backend/internal/orchestration/customer_wallet.go) — NGN lands in the
-- main platform ledger, other currencies in orch_balances.

-- ─── 1. A real join key for matching a webhook to its virtual account ────────
ALTER TABLE orch_collections ADD COLUMN IF NOT EXISTS provider_ref text;

-- Backfill from where the value already sits, so accounts provisioned before
-- this migration are matchable too.
UPDATE orch_collections
   SET provider_ref = details->>'account_number'
 WHERE provider_ref IS NULL
   AND details ? 'account_number';

-- Partial: only provisioned accounts carry a provider handle.
CREATE INDEX IF NOT EXISTS orch_collections_provider_ref_idx
    ON orch_collections (provider, provider_ref)
 WHERE provider_ref IS NOT NULL;

-- ─── 2. Inbound collection events ───────────────────────────────────────────
-- One row per credited deposit. Written ONLY inside the crediting transaction,
-- so a row here and the balance movement can never disagree.
CREATE TABLE IF NOT EXISTS orch_collection_events (
    id                 text PRIMARY KEY,
    customer_id        text NOT NULL,
    virtual_account_id text NOT NULL REFERENCES orch_collections(id),
    currency           text NOT NULL,
    -- Integer MINOR units (kobo/cents). Never a float, never a string.
    amount_minor       bigint NOT NULL CHECK (amount_minor > 0),
    provider           text NOT NULL,
    -- The provider's event id. This is the dedupe key: a redelivered webhook
    -- must not credit twice.
    provider_event_id  text NOT NULL,
    provider_ref       text,
    sender_name        text,
    reference          text,
    created_at         timestamptz NOT NULL DEFAULT now()
);

-- The idempotency guarantee. Scoped by provider because two providers may
-- legitimately mint the same event id.
CREATE UNIQUE INDEX IF NOT EXISTS orch_collection_events_provider_event_uniq
    ON orch_collection_events (provider, provider_event_id);

-- List path: GET /api/v1/fx/collections, newest first, scoped to the customer.
-- id breaks created_at ties so pagination cannot skip or repeat a row.
CREATE INDEX IF NOT EXISTS orch_collection_events_customer_idx
    ON orch_collection_events (customer_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS orch_collection_events_va_idx
    ON orch_collection_events (virtual_account_id);

COMMENT ON TABLE orch_collection_events IS
    'Inbound FX collections (deposits into a provisioned virtual account/IBAN). One row per credited deposit, written inside the crediting transaction. Unique on (provider, provider_event_id) so a redelivered webhook is a no-op.';
COMMENT ON COLUMN orch_collections.provider_ref IS
    'The provider''s own handle for this account (Maplerad: the virtual account number). Join key for matching an inbound webhook back to its customer and currency.';
