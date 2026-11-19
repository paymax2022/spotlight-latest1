// Where each provider business lives. One entry per type: its management home,
// and where an applicant starts. Pure — no React Native or icon imports — so it
// runs under node:test, like gate.ts. Extending the backend's capabilities query
// is the only other thing needed for a new type to appear.
//
// `apply` is omitted where the app has no self-serve application flow (the record
// is granted by ops), so the type never appears in the "become a provider" list.

import type { ProviderType } from './gate';

export interface PortalRoute {
  label: string;
  home: string;
  apply?: string;
}

export const PORTAL_ROUTES: Record<ProviderType, PortalRoute> = {
  doctor: { label: 'Doctor', home: '/(doctor)/(tabs)', apply: '/(doctor)/onboarding' },
  vet: { label: 'Veterinary', home: '/health/vet/provider/requests', apply: '/health/vet/provider/onboarding' },
  pharmacy: { label: 'Pharmacy', home: '/health/pharmacy/provider', apply: '/health/pharmacy/provider/onboarding' },
  lab: { label: 'Laboratory', home: '/health/lab/provider/orders', apply: '/health/lab/provider/onboarding' },
  restaurant: { label: 'Restaurant', home: '/food/restaurant', apply: '/food/restaurant/kyb' },
  // Riders are onboarded in Mobility; the food console only takes offers.
  rider: { label: 'Delivery rider', home: '/food/rider', apply: '/mobility/driver/onboarding' },
  driver: { label: 'Driver', home: '/mobility/driver', apply: '/mobility/driver/onboarding' },
  marketplace_seller: { label: 'Marketplace shop', home: '/marketplace/sell', apply: '/marketplace/sell' },
  event_organiser: { label: 'Event organiser', home: '/events/organiser/dashboard', apply: '/events/organiser/create' },
  // Estate management is granted with the estate itself; /estate-admin is the console.
  estate_manager: { label: 'Estate', home: '/estate-admin' },
  property_manager: { label: 'Property manager', home: '/property/roles', apply: '/property/role-profile' },
  association_creator: { label: 'Association', home: '/association/admin', apply: '/association/create' },
  crowdfunding_creator: { label: 'Campaign', home: '/crowdfunding/creator', apply: '/crowdfunding/create' },
  bus_owner: { label: 'Bus operator', home: '/mobility/bus/provider', apply: '/mobility/bus/provider/register' },
};

/**
 * The route a capability row should open: approved providers get their console,
 * everyone else gets the flow that earns approval — or the console when there is
 * nothing to apply for.
 */
export function portalRoute(type: ProviderType, approved: boolean): string {
  const meta = PORTAL_ROUTES[type];
  return approved ? meta.home : meta.apply ?? meta.home;
}
