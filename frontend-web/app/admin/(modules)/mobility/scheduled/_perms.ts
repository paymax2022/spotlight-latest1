// Permission keys for the Scheduled Bookings ops console. Kept separate from
// MOBILITY_PERMS in ../_ui.tsx (which we do not modify) because these are a
// distinct `transport.admin.scheduled.*` namespace per
// docs/prd/transport-scheduling/SWARM_INTEGRATION_CONTRACT.md, not the legacy
// `mobility.*` namespace. Consumed via the shared useMobilityPermissions().can()
// helper, which just checks raw permission strings against the admin user.
export const SCHEDULED_PERMS = {
  read: ['transport.admin.scheduled.read'],
  reassign: ['transport.admin.scheduled.reassign'],
  cancel: ['transport.admin.scheduled.cancel'],
};
