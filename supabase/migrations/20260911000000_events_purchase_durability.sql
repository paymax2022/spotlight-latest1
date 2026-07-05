-- Top-5 Events — Purchase crash-durability (PENDING → debit → PAID, resumable).
--
-- Fixes the ledger-auditor finding that Purchase committed the order as 'PAID'
-- BEFORE the wallet debit, so a crash in the gap left a paid-looking order with
-- no money taken and no retry path. The order now lands 'PENDING', the debit runs,
-- then it flips 'PAID'; a resumed/ swept finalize completes or expires it.
--
-- Additive-only: widens a CHECK domain (no previously-valid row is invalidated),
-- adds a nullable column, and adds a unique index. No DROP of data, no rename, no
-- type narrowing. Safe to re-run.

BEGIN;

-- 1. Widen the order status domain: 'PENDING' (reserved, not yet paid) and
--    'EXPIRED' (reservation released after a refused/never-completed debit).
--    Existing rows are 'PAID'/'REFUNDED' — both remain valid under the wider set.
ALTER TABLE public.event_orders DROP CONSTRAINT IF EXISTS event_orders_status_check;
ALTER TABLE public.event_orders
  ADD CONSTRAINT event_orders_status_check
  CHECK (status IN ('PENDING','PAID','REFUNDED','EXPIRED'));

-- 2. Persist the tier on the order so a resumed finalize (after a crash between
--    reservation and ticket issuance) can mint the correct ticket. Nullable —
--    pre-existing orders never need it.
ALTER TABLE public.event_orders
  ADD COLUMN IF NOT EXISTS tier_id uuid REFERENCES public.event_ticket_tiers(id) ON DELETE SET NULL;

-- 3. Exactly one ticket per order — makes ticket issuance idempotent, so a resumed
--    Purchase can never mint a second ticket/credential for the same paid order.
--    GiftTicket mutates the ticket row in place (UPDATE), so this does not block
--    transfers.
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_tickets_order ON public.event_tickets (order_id);

COMMIT;
