-- ADDITIVE ONLY: Add facilities management permissions for estate admin RBAC.
-- Permissions follow the pattern: estate.admin.facilities.{action}
-- These permissions gate facility creation, editing, and booking management.

INSERT INTO public.permissions (slug, name, description)
VALUES
  ('estate.admin.facilities.create', 'Create Facilities', 'Can create new facilities in estates'),
  ('estate.admin.facilities.edit', 'Edit Facilities', 'Can modify facility details (name, capacity, fees)'),
  ('estate.admin.facilities.delete', 'Delete Facilities', 'Can delete facilities'),
  ('estate.admin.facilities.bookings.view', 'View Facility Bookings', 'Can view facility booking history'),
  ('estate.admin.facilities.bookings.approve', 'Approve Facility Bookings', 'Can approve pending facility reservations'),
  ('estate.admin.facilities.bookings.cancel', 'Cancel Facility Bookings', 'Can cancel bookings and process refunds')
ON CONFLICT (slug) DO NOTHING;
