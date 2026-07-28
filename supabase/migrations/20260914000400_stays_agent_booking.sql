-- ── Stays: agent-assisted booking channel (additive) ────────────────────────
-- A travel-agent (a member with an agent role) books on behalf of a walk-in
-- customer and earns commission. The booking still lives on the SAME
-- stays_reservation row via the SAME reservation.Book saga (escrow→settle); we
-- only TAG the row with who the booking agent was and who the walk-in customer
-- is. No new ledger account — the agent commission reuses the reservation saga's
-- existing DirectCommission split account.
--
-- IRON RULE — additive only: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT
-- EXISTS. No DROP, no rename, no type narrowing. Safe to replay.
--
-- NOTE: the table is stays_reservation (SINGULAR).

ALTER TABLE IF EXISTS public.stays_reservation
  ADD COLUMN IF NOT EXISTS agent_user_id    uuid,
  ADD COLUMN IF NOT EXISTS customer_name    text,
  ADD COLUMN IF NOT EXISTS customer_contact text;

COMMENT ON COLUMN public.stays_reservation.agent_user_id IS
  'Booking agent (member with agent role) who created this reservation on behalf of a walk-in customer. NULL for self-service bookings.';
COMMENT ON COLUMN public.stays_reservation.customer_name IS
  'Walk-in customer display name captured by the agent at book time (agent channel only).';
COMMENT ON COLUMN public.stays_reservation.customer_contact IS
  'Walk-in customer contact (phone/email) captured by the agent at book time (agent channel only).';

-- List/aggregate an agent''s bookings efficiently (agent bookings + commissions).
CREATE INDEX IF NOT EXISTS idx_stays_reservation_agent_user_id
  ON public.stays_reservation (agent_user_id)
  WHERE agent_user_id IS NOT NULL;
