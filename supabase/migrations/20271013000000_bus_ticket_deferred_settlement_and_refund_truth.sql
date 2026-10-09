-- Wallet bus path: truthful refunds + deferred settlement support.
-- ADR-PR559-bus-wallet-fixes.
--
-- Background: BookBusTicket used to Settle the operator at booking, so a later
-- cancel could not refund (settlement.Refund only works on 'escrowed') yet the
-- ticket was still flipped to payment_status='refunded'. These columns let the
-- service (a) freeze the provider/platform split and payout recipient at booking
-- time, (b) hold the fare in escrow until departure + grace when
-- FEATURE_TRANSPORT_BUS_DEFERRED_SETTLEMENT is on, and (c) report a truthful
-- refund_status that is only 'refunded' after the wallet credit posted.
--
-- ADDITIVE-ONLY: ADD COLUMN IF NOT EXISTS, every new column is nullable or has a
-- default that is correct for already-existing rows (existing tickets were
-- settled at booking => settle_mode 'immediate', payout_state 'released').

-- ─── bus_schedules: per-schedule self-service cancel cutoff ──────────────────
-- NULL => use the service default (TRANSPORT_BUS_CANCEL_CUTOFF_MINUTES, 120).
ALTER TABLE bus_schedules ADD COLUMN IF NOT EXISTS cancel_cutoff_minutes INTEGER
    CHECK (cancel_cutoff_minutes IS NULL OR cancel_cutoff_minutes BETWEEN 60 AND 1440);

-- ─── bus_tickets ─────────────────────────────────────────────────────────────
-- immediate: operator paid on issue (legacy). deferred: fare stays escrowed until
-- the settle sweeper releases it at departure + grace.
ALTER TABLE bus_tickets ADD COLUMN IF NOT EXISTS settle_mode TEXT NOT NULL DEFAULT 'immediate'
    CHECK (settle_mode IN ('immediate','deferred'));
-- held: settlement still escrowed (refundable). releasing: a settle is in flight
-- (blocks cancel). released: paid out to the provider (not refundable by wallet path).
-- DEFAULT 'released' is correct for every pre-existing row (settled at booking).
ALTER TABLE bus_tickets ADD COLUMN IF NOT EXISTS payout_state TEXT NOT NULL DEFAULT 'released'
    CHECK (payout_state IN ('held','releasing','released'));
-- Split + recipient FROZEN at booking time (settle never re-reads
-- transport_commission_config or the provider owner).
ALTER TABLE bus_tickets ADD COLUMN IF NOT EXISTS provider_pct    NUMERIC(9,6);
ALTER TABLE bus_tickets ADD COLUMN IF NOT EXISTS platform_pct    NUMERIC(9,6);
ALTER TABLE bus_tickets ADD COLUMN IF NOT EXISTS settle_user_id  UUID;
-- Cutoff frozen at booking time (deferred tickets only).
ALTER TABLE bus_tickets ADD COLUMN IF NOT EXISTS cancel_cutoff_minutes INTEGER
    CHECK (cancel_cutoff_minutes IS NULL OR cancel_cutoff_minutes BETWEEN 60 AND 1440);
-- Truthful refund state. 'refunded' is written ONLY after settlement.Refund
-- succeeded. manual_required = already paid out to the operator; ops must refund.
ALTER TABLE bus_tickets ADD COLUMN IF NOT EXISTS refund_status TEXT NOT NULL DEFAULT 'none'
    CHECK (refund_status IN ('none','pending','refunded','failed','manual_required'));
ALTER TABLE bus_tickets ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE bus_tickets ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMPTZ;
ALTER TABLE bus_tickets ADD COLUMN IF NOT EXISTS refunded_at   TIMESTAMPTZ;
ALTER TABLE bus_tickets ADD COLUMN IF NOT EXISTS settled_at    TIMESTAMPTZ;
-- When the current settle attempt claimed payout_state='releasing'. A 'releasing'
-- claim older than ~5 minutes is considered abandoned and may be re-claimed; a fresh
-- one may not (prevents two settlers overlapping).
ALTER TABLE bus_tickets ADD COLUMN IF NOT EXISTS payout_claimed_at TIMESTAMPTZ;

-- Sweeper access paths (small partial indexes).
CREATE INDEX IF NOT EXISTS bus_tickets_payout_pending_idx
    ON bus_tickets(schedule_id) WHERE payout_state IN ('held','releasing');
CREATE INDEX IF NOT EXISTS bus_tickets_refund_open_idx
    ON bus_tickets(cancelled_at) WHERE refund_status IN ('pending','failed');

-- ─── event_transport_bookings: truthful refund state ─────────────────────────
ALTER TABLE event_transport_bookings ADD COLUMN IF NOT EXISTS refund_status TEXT NOT NULL DEFAULT 'none'
    CHECK (refund_status IN ('none','pending','refunded','failed','manual_required'));
