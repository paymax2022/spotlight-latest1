// Where the bare /events/organiser route sends the caller. Pure so it is tested
// without the router: an organiser lands on their dashboard, anyone else on the
// events list.

export type OrganiserIndexTarget = '/events/organiser/dashboard' | '/events';

export function organiserIndexTarget(isOrganiser: boolean): OrganiserIndexTarget {
  return isOrganiser ? '/events/organiser/dashboard' : '/events';
}
