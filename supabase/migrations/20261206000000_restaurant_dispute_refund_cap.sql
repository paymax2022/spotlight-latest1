-- Restaurant / Delivery — cap the cumulative PLATFORM-funded dispute refund per order
-- (additive-only). See docs/adr/ADR-031-dispute-refund-caps-and-funding.md.
--
-- Context: `restaurant_dispute_refunds` is keyed by dispute_id, and the shared `disputes`
-- table blocks only a concurrently ACTIVE ticket per order (status in open/investigating)
-- while orders.disputed_at is a marker rather than a gate. So once a dispute resolves, a
-- second one is raisable on the same still-`delivered` order, and each upheld refund_full
-- credited the customer the whole platform-funded basis AGAIN out of paymax_revenue —
-- N times for N disputes. This predates the tip work; the tip leg was capped per order by
-- 20261205000000, and this closes the same hole on the (much larger) platform leg.
--
-- The service serialises the read-compute-spend-record sequence under an advisory lock
-- keyed on the order. This trigger is the storage-layer backstop, so a writer that forgets
-- the lock — or any path that inserts into this table directly — cannot exceed the cap.
--
-- IT TAKES THE SAME ADVISORY LOCK ITSELF, and must. A plain recompute-and-compare is NOT a
-- constraint: at READ COMMITTED two concurrent inserts for one order each see only the
-- committed rows plus their own, so both pass the check and both commit, landing the order
-- over cap. Taking `dispute-refund:<order_id>` before the SUM makes the read-modify-write
-- serial. The key is byte-identical to the service's (which lowercases the order id), and
-- pg_advisory_xact_lock is re-entrant within a session, so the service path — which already
-- holds it — is unaffected.
--
-- The cap is the same non-tip basis the service computes: total_kobo − tip_kobo, floored
-- at 0. The tip is excluded because it was paid straight through to the rider at
-- settlement and the platform never held it (ADR-031).
--
-- The check is gated on the NEW row actually moving money. A zero-kobo row (a `dismissed`
-- or `replacement` resolution) must always be insertable, even on an order whose historical
-- refunds already exceed the cap — those orders are exactly what this migration exists to
-- stop growing, and ops still has to be able to close their tickets. Without the gate the
-- admin endpoint would fail forever on precisely the legacy data in question.
--
-- NOT a defence against a superuser: `ALTER TABLE ... DISABLE TRIGGER` and
-- `session_replication_role = 'replica'` (used by some restore/replication tooling) both
-- skip it. Restores and backfills must re-validate the invariant themselves.
--
-- Additive only — new function + new trigger, no DROP / RENAME / type narrowing, and no
-- change to existing rows. Creating the trigger does NOT validate existing data, so it
-- cannot fail on an already-over-cap order; audit for those separately with
--   SELECT r.order_id, SUM(r.refund_kobo), GREATEST(o.total_kobo-COALESCE(o.tip_kobo,0),0)
--     FROM restaurant_dispute_refunds r JOIN orders o ON o.id=r.order_id
--    GROUP BY r.order_id, o.total_kobo, o.tip_kobo
--   HAVING SUM(r.refund_kobo) > GREATEST(o.total_kobo-COALESCE(o.tip_kobo,0),0);
-- Money has already left on any row that returns; remediation is a product decision.

CREATE OR REPLACE FUNCTION restaurant_dispute_refund_cap_check()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    cap_kobo      BIGINT;
    refunded_kobo BIGINT;
BEGIN
    -- A zero-kobo resolution (dismissed / replacement) moves no money and can never push an
    -- order over its cap, so it is always allowed — including on an order whose historical
    -- refunds are already over. Checking it would make legacy over-cap tickets unclosable.
    IF COALESCE(NEW.refund_kobo, 0) <= 0 THEN
        RETURN NEW;
    END IF;

    SELECT GREATEST(o.total_kobo - COALESCE(o.tip_kobo, 0), 0)
      INTO cap_kobo
      FROM orders o
     WHERE o.id = NEW.order_id;

    -- No order row (should be impossible — order_id is a FK) ⇒ nothing to check against.
    IF cap_kobo IS NULL THEN
        RETURN NEW;
    END IF;

    -- Serialise the recompute against concurrent inserts for this order. Without this the
    -- check is not a constraint at all: at READ COMMITTED two overlapping transactions each
    -- see only committed rows plus their own, both pass, and the order lands over cap.
    -- Same key as the service (lowercased order id); re-entrant, so the service path is
    -- unaffected.
    PERFORM pg_advisory_xact_lock(hashtext('dispute-refund:' || lower(NEW.order_id::text)));

    -- AFTER trigger, so NEW is already visible to this SUM.
    SELECT COALESCE(SUM(refund_kobo), 0)
      INTO refunded_kobo
      FROM restaurant_dispute_refunds
     WHERE order_id = NEW.order_id;

    IF refunded_kobo > cap_kobo THEN
        RAISE EXCEPTION
            'restaurant_dispute_refunds: cumulative refund % kobo exceeds the platform-refundable % kobo for order % (a dispute refund may never return more than the platform took in)',
            refunded_kobo, cap_kobo, NEW.order_id
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS restaurant_dispute_refunds_cap_trg ON restaurant_dispute_refunds;
CREATE CONSTRAINT TRIGGER restaurant_dispute_refunds_cap_trg
    AFTER INSERT OR UPDATE OF refund_kobo, order_id ON restaurant_dispute_refunds
    NOT DEFERRABLE
    FOR EACH ROW
    EXECUTE FUNCTION restaurant_dispute_refund_cap_check();
