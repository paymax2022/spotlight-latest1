-- Mark the seeded demo rows in cf_refunds / cf_settlements as demo data.
--
-- WHY
-- ---
-- The crowdfunding finance console reads two different data planes and says so
-- nowhere. GMV and escrow are derived from the real `contributions` table. The
-- refund queue and the settlement batch table are read from `cf_refunds` and
-- `cf_settlements` — and a repo-wide search finds exactly ONE writer for either
-- table: the seed block in 20260622050000_crowdfunding_admin.sql. No Go path, no
-- RPC, no webhook, no admin action ever inserts a row into them.
--
-- So every row an operator sees under those two headings is a fixture, and the
-- page presented them beside live GMV with identical styling. The figures cannot
-- be reconciled with each other — ₦25,000 of "pending refunds" against ₦1,050 of
-- lifetime GMV, ₦7.2M of settlement batches against ₦0 settled this month — and
-- an operator has no way to tell which half is real.
--
-- A column rather than a hardcoded list in the application: when a real refund
-- pipeline is built it will INSERT with the DEFAULT false and be shown as live
-- automatically, with no second place to remember to update. The flag describes
-- the row, so it cannot drift away from the row.
--
-- Additive only: nullable-equivalent (NOT NULL with a DEFAULT), no drops, no
-- renames, no type changes, and the backfill touches only the six references the
-- seed migration created by name — never a prefix pattern, which would silently
-- relabel real rows if a future pipeline reuses the SPL-RF-/SPL-STL- prefixes.

ALTER TABLE public.cf_refunds
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.cf_settlements
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.cf_refunds.is_demo IS
  'TRUE for rows created by the 20260622050000 seed block. The admin console renders these as sample data. Real rows insert with the FALSE default.';
COMMENT ON COLUMN public.cf_settlements.is_demo IS
  'TRUE for rows created by the 20260622050000 seed block. The admin console renders these as sample data. Real rows insert with the FALSE default.';

UPDATE public.cf_refunds
   SET is_demo = TRUE
 WHERE reference IN ('SPL-RF-7001', 'SPL-RF-7002', 'SPL-RF-6990');

UPDATE public.cf_settlements
   SET is_demo = TRUE
 WHERE reference IN ('SPL-STL-2026-06-19', 'SPL-STL-2026-06-18', 'SPL-STL-2026-06-17');
