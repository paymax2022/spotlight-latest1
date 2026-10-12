-- Events ticketing depth (Phase 2): tier sales windows + invite-only tiers,
-- richer promo codes (tier scope, flat amount, validity window, per-user limit)
-- and a per-order promo redemption ledger for per-user-limit enforcement.
--
-- SAFETY: additive-only per CLAUDE.md. New nullable/defaulted columns and one new
-- table. No DROP, no rename, no type narrowing. Re-runnable (IF NOT EXISTS,
-- DROP POLICY IF EXISTS before CREATE POLICY). Multi-quantity purchase
-- (min/max per order) is intentionally NOT part of this migration.

BEGIN;

ALTER TABLE public.event_ticket_tiers ADD COLUMN IF NOT EXISTS sales_start_at timestamptz;
ALTER TABLE public.event_ticket_tiers ADD COLUMN IF NOT EXISTS sales_end_at   timestamptz;
ALTER TABLE public.event_ticket_tiers ADD COLUMN IF NOT EXISTS description    text NOT NULL DEFAULT '';
ALTER TABLE public.event_ticket_tiers ADD COLUMN IF NOT EXISTS invite_only    boolean NOT NULL DEFAULT false;

ALTER TABLE public.event_promo_codes ADD COLUMN IF NOT EXISTS tier_id uuid REFERENCES public.event_ticket_tiers(id) ON DELETE CASCADE;
ALTER TABLE public.event_promo_codes ADD COLUMN IF NOT EXISTS amount_off_kobo bigint CHECK (amount_off_kobo >= 0);
ALTER TABLE public.event_promo_codes ADD COLUMN IF NOT EXISTS starts_at timestamptz;
ALTER TABLE public.event_promo_codes ADD COLUMN IF NOT EXISTS ends_at   timestamptz;
ALTER TABLE public.event_promo_codes ADD COLUMN IF NOT EXISTS per_user_limit int NOT NULL DEFAULT 0 CHECK (per_user_limit >= 0);
CREATE INDEX IF NOT EXISTS idx_event_promo_codes_tier ON public.event_promo_codes (tier_id) WHERE tier_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.event_promo_redemptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_id   uuid NOT NULL REFERENCES public.event_promo_codes(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id   uuid NOT NULL REFERENCES public.event_orders(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_promo_redemptions_promo_order
  ON public.event_promo_redemptions (promo_id, order_id);
CREATE INDEX IF NOT EXISTS idx_event_promo_redemptions_promo_user
  ON public.event_promo_redemptions (promo_id, user_id);

ALTER TABLE public.event_promo_redemptions ENABLE ROW LEVEL SECURITY;

-- Backend reaches this table over a direct pgx connection as the table owner
-- (bypasses RLS), same as every other top5events table — these policies are for
-- any future PostgREST/supabase-js access, not the Go service path itself.
DROP POLICY IF EXISTS event_promo_redemptions_read ON public.event_promo_redemptions;
CREATE POLICY event_promo_redemptions_read ON public.event_promo_redemptions
  FOR SELECT TO authenticated USING (
    public.is_admin()
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.event_promo_codes p
      JOIN public.events e ON e.id = p.event_id
      WHERE p.id = event_promo_redemptions.promo_id AND e.organiser_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS event_promo_redemptions_service ON public.event_promo_redemptions;
CREATE POLICY event_promo_redemptions_service ON public.event_promo_redemptions
  TO service_role USING (true) WITH CHECK (true);

COMMIT;
