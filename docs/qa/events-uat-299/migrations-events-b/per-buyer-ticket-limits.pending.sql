-- PENDING (UAT lane events-b): per-order and per-buyer ticket limits.
-- Covers EVT-UAT-099 / EVT-UAT-105 / EVT-UAT-134 — today a buyer can place
-- any number of orders against a tier; nothing enforces an organiser-set cap.
-- Additive only; 0 keeps the current uncapped behaviour.
-- Server-side enforcement lands in top5events.Purchase: count the buyer's
-- tickets for the tier (event_tickets JOIN event_orders on buyer) inside the
-- same FOR UPDATE tier lock that guards sold<capacity.

ALTER TABLE event_ticket_tiers
    ADD COLUMN IF NOT EXISTS max_per_order integer NOT NULL DEFAULT 0
        CHECK (max_per_order >= 0),
    ADD COLUMN IF NOT EXISTS max_per_buyer integer NOT NULL DEFAULT 0
        CHECK (max_per_buyer >= 0);
