-- ADDITIVE ONLY: Add facilities management permissions for estate admin RBAC.
-- Permissions follow the pattern: estate.admin.facilities.{action}
-- These permissions gate facility creation, editing, and booking management.
--
-- RENUMBERED from 20260909000000, which collided with
-- 20260909000000_association_chat_reactions.sql. schema_migrations is keyed on the
-- version alone, so two files sharing one abort the chain partway through. The
-- association migration reached the branch first, so this one renumbers — to a
-- version after the then-current maximum (20270194000000), per
-- scripts/ci/check-migration-versions.sh. Position is safe: this only seeds rows
-- into public.permissions, so it has no ordering dependency beyond that table.
--
-- The column list previously named only (slug, name, description) and failed the
-- chain outright:
--   ERROR: null value in column "module" of relation "permissions"
-- module, resource and action are ALL NOT NULL with no default, so naming just one
-- of them would simply have moved the failure to the next column. Values follow the
-- existing estate rows (module='estate', resource=the noun, action=the verb,
-- is_system_permission=true).

INSERT INTO public.permissions (slug, name, module, resource, action, description, is_system_permission)
VALUES
  ('estate.admin.facilities.create',           'Create Facilities',          'estate', 'facilities',         'create',  'Can create new facilities in estates',                 true),
  ('estate.admin.facilities.edit',             'Edit Facilities',            'estate', 'facilities',         'edit',    'Can modify facility details (name, capacity, fees)',   true),
  ('estate.admin.facilities.delete',           'Delete Facilities',          'estate', 'facilities',         'delete',  'Can delete facilities',                                true),
  ('estate.admin.facilities.bookings.view',    'View Facility Bookings',     'estate', 'facility_bookings',  'view',    'Can view facility booking history',                    true),
  ('estate.admin.facilities.bookings.approve', 'Approve Facility Bookings',  'estate', 'facility_bookings',  'approve', 'Can approve pending facility reservations',            true),
  ('estate.admin.facilities.bookings.cancel',  'Cancel Facility Bookings',   'estate', 'facility_bookings',  'cancel',  'Can cancel bookings and process refunds',              true)
ON CONFLICT (slug) DO NOTHING;
