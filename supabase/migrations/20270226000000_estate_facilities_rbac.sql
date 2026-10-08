-- ADDITIVE ONLY: Add facilities management permissions for estate admin RBAC.
-- Permissions follow the pattern: estate.admin.facilities.{action}
-- These permissions gate facility creation, editing, and booking management.

-- module/resource/action are NOT NULL on public.permissions; the original
-- version of this file only supplied (slug, name, description) and was
-- therefore never actually applicable -- it silently blocked every later
-- migration from applying via `supabase migration up` for any session
-- sharing this local database until fixed here.
INSERT INTO public.permissions (slug, name, description, module, resource, action)
VALUES
  ('estate.admin.facilities.create', 'Create Facilities', 'Can create new facilities in estates', 'estate', 'facilities', 'create'),
  ('estate.admin.facilities.edit', 'Edit Facilities', 'Can modify facility details (name, capacity, fees)', 'estate', 'facilities', 'edit'),
  ('estate.admin.facilities.delete', 'Delete Facilities', 'Can delete facilities', 'estate', 'facilities', 'delete'),
  ('estate.admin.facilities.bookings.view', 'View Facility Bookings', 'Can view facility booking history', 'estate', 'facilities.bookings', 'view'),
  ('estate.admin.facilities.bookings.approve', 'Approve Facility Bookings', 'Can approve pending facility reservations', 'estate', 'facilities.bookings', 'approve'),
  ('estate.admin.facilities.bookings.cancel', 'Cancel Facility Bookings', 'Can cancel bookings and process refunds', 'estate', 'facilities.bookings', 'cancel')
ON CONFLICT (slug) DO NOTHING;
