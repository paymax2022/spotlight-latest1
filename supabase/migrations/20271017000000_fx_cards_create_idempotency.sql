-- ── FX card-create idempotency ───────────────────────────────────────────────
-- Additive-only migration closing the double-create hole on
-- POST /api/v1/fx/cards.
--
-- 20261003000000_fx_cards_collections.sql deduped card FUNDING on
-- (business_id, idempotency_key) via orch_fx_card_txns, but the card-create row
-- itself carried no key — a retried Idempotency-Key minted a SECOND card for the
-- same client intent (two rows, one logical request).
--
-- Mirrors the orch_fx_card_txns convention exactly: a nullable idempotency_key
-- column plus a partial unique index on (business_id, idempotency_key). The Go
-- store probes by key first (replay → returns the existing card), and a
-- concurrent same-key race is arbitrated by this index — the losing insert gets
-- 23505 and re-selects the winner's row. NULL keys are unaffected (rows created
-- before this column existed, and any non-HTTP store-level callers).

ALTER TABLE orch_fx_cards
    ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS orch_fx_cards_idem_uniq
    ON orch_fx_cards (business_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
