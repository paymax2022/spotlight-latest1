-- PENDING — stays-b UAT lane. NOT APPLIED. Orchestrator applies + renumbers at
-- consolidation. Additive-only.
--
-- REQ-OPS fulfillment gap (STYB-D001): the reservation FSM has CONFIRMED and
-- COMPLETED but no ops layer — no check-in/out timestamps, physical room
-- assignment, housekeeping, turnover buffer, caution deposit, or damage claim
-- tracking. Covers STY-OPS-002..006, 010..015, 017, 019..021, STY-PAY-020,
-- STY-FIN-019, STY-MOD-012/021 partially.
--
-- States are expressed as timestamps, NOT new `state` enum values, so the
-- existing guarded FSM (state CHECK constraint) needs no alteration:
--   CONFIRMED + checked_in_at IS NULL     -> booked, not arrived
--   CONFIRMED + checked_in_at             -> in-house
--   COMPLETED (check_out)                 -> departed (existing terminal state)
-- Deposit liability rides the existing settlement/ledger primitives
-- (escrow -> refund on release / partial deduction legs) — never a balance col.

BEGIN;

ALTER TABLE public.stays_reservation
  ADD COLUMN IF NOT EXISTS checked_in_at          timestamptz,
  ADD COLUMN IF NOT EXISTS checked_in_by          uuid,          -- operator (hotelier staff user) or NULL = self
  ADD COLUMN IF NOT EXISTS checked_out_at         timestamptz,
  ADD COLUMN IF NOT EXISTS checked_out_by         uuid,
  ADD COLUMN IF NOT EXISTS id_verified_at         timestamptz,   -- guest ID verified at check-in (OPS-002)
  ADD COLUMN IF NOT EXISTS assigned_room_label    text,          -- physical unit/room assignment (OPS-005)
  ADD COLUMN IF NOT EXISTS early_checkin_kobo     bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_checkout_kobo     bigint NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_stays_reservation_arrival
  ON public.stays_reservation (property_id, check_in) WHERE state = 'CONFIRMED';
CREATE INDEX IF NOT EXISTS idx_stays_reservation_inhouse
  ON public.stays_reservation (property_id) WHERE checked_in_at IS NOT NULL AND checked_out_at IS NULL;

-- HOUSEKEEPING / TURNOVER — room-status board per physical unit (OPS-010/015/021).
CREATE TABLE IF NOT EXISTS public.stays_room_unit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   uuid NOT NULL REFERENCES public.stays_property(id) ON DELETE CASCADE,
  room_type_id  uuid NOT NULL REFERENCES public.stays_room_type(id) ON DELETE CASCADE,
  label         text NOT NULL,              -- e.g. "D-204" / "Unit A"
  status        text NOT NULL DEFAULT 'CLEAN'
                CHECK (status IN ('CLEAN','DIRTY','CLEANING','INSPECTED','OUT_OF_ORDER')),
  blocked_until date,                       -- turnover buffer (OPS-017)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, label)
);

-- CAUTION DEPOSIT — liability tracked separately from merchant proceeds
-- (OPS-014, PAY-020, FIN-019): held on the guest's booking, released or
-- partially deducted only via adjudicated damage claims.
CREATE TABLE IF NOT EXISTS public.stays_deposit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id  uuid NOT NULL REFERENCES public.stays_reservation(id) ON DELETE CASCADE,
  amount_kobo     bigint NOT NULL CHECK (amount_kobo > 0),
  status          text NOT NULL DEFAULT 'HELD'
                  CHECK (status IN ('HELD','RELEASED','PART_DEDUCTED','FORFEITED')),
  released_at     timestamptz,
  ledger_ref      text NOT NULL DEFAULT '',
  idempotency_key text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reservation_id),
  UNIQUE (idempotency_key)
);

-- DAMAGE CLAIM — adjudicated deduction against a held deposit (OPS-013/014).
CREATE TABLE IF NOT EXISTS public.stays_damage_claim (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id      uuid NOT NULL REFERENCES public.stays_deposit(id) ON DELETE CASCADE,
  reservation_id  uuid NOT NULL REFERENCES public.stays_reservation(id) ON DELETE CASCADE,
  amount_kobo     bigint NOT NULL CHECK (amount_kobo >= 0),
  reason          text NOT NULL,
  evidence_urls   jsonb NOT NULL DEFAULT '[]'::jsonb,
  status          text NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  decided_by      uuid,
  decided_at      timestamptz,
  ledger_ref      text NOT NULL DEFAULT '',
  idempotency_key text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);

COMMIT;
