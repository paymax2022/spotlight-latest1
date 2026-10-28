-- Health Lab order pricing: packages and the home-visit fee. Additive only.
--   * lab_orders.home_fee_kobo  — the lab's home-visit fee charged on this order,
--     read server-side from lab_profiles at order time and held in escrow with the
--     rest. total_kobo = SUM(lab_order_lines.unit_price_kobo) + home_fee_kobo.
--   * lab_order_lines.package_id — set when a line came from a package. A package
--     expands to one line per test, with the package price allocated across them so
--     the lines sum to exactly the package price (results/release stay per test).
-- Existing orders default to home_fee_kobo = 0 and package_id = NULL, so their
-- totals still reconcile.

ALTER TABLE public.lab_orders
  ADD COLUMN IF NOT EXISTS home_fee_kobo bigint NOT NULL DEFAULT 0 CHECK (home_fee_kobo >= 0);

ALTER TABLE public.lab_order_lines
  ADD COLUMN IF NOT EXISTS package_id uuid REFERENCES public.lab_packages(id) ON DELETE SET NULL;
