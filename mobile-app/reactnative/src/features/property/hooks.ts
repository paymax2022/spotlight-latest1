// ── Property Management — React Query hooks ──────────────────────────────────
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';
import { moduleQueryOptions } from '@/lib/moduleAvailability';
import type { SwitchContextInput } from './types';

export const propertyKeys = {
  all:          ['property'] as const,
  context:      () => [...propertyKeys.all, 'context'] as const,
  rentPassport: () => [...propertyKeys.all, 'rent-passport'] as const,
  gatePass:     (bookingId: string) => [...propertyKeys.all, 'gate-pass', bookingId] as const,
};

/**
 * Active estate/property/agency/org context + the list the user can switch between.
 *
 * A 404 here means the property suite is not registered in this environment:
 * the whole /api/finance/property/* group sits behind FEATURE_PROPERTY_SUITE_ENABLED,
 * which defaults to false, so an unset flag makes every path under it 404 rather
 * than the module reporting itself as off.
 *
 * That was firing repeatedly. React Query retries by default and refetches on
 * window focus, and because ContextSwitcher seeds this cache from the Property
 * screens, the refetch followed the user around — a /property call 404ing on a
 * visitor-code page that has nothing to do with property.
 *
 * A 404 is now terminal: asked once, not retried, not re-asked on focus. It is
 * deliberately NOT swallowed into a null result — a route that has genuinely gone
 * missing is a defect worth seeing, and this codebase has produced several, so the
 * error still surfaces to the caller. What changes is that it is reported once
 * instead of on every focus event.
 */
export function useContext() {
  return useQuery({
    queryKey: propertyKeys.context(),
    queryFn: api.getContext,
    ...moduleQueryOptions(),
  });
}


export function useSwitchContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SwitchContextInput) => api.switchContext(input),
    onSuccess: (envelope) => {
      // Seed the cache so the switcher reflects the new active context instantly,
      // then invalidate everything scoped to the old context.
      qc.setQueryData(propertyKeys.context(), envelope);
      qc.invalidateQueries({ queryKey: propertyKeys.all });
    },
  });
}

/** Portable, cross-landlord tenancy reputation (M-RTN-05). */
export function useRentPassport() {
  return useQuery({ queryKey: propertyKeys.rentPassport(), queryFn: api.getRentPassport });
}

/** Auto-issued estate gate pass for a confirmed stay (null when none). */
export function useStayGatePass(bookingId: string | undefined) {
  return useQuery({
    queryKey: propertyKeys.gatePass(String(bookingId)),
    queryFn:  () => api.getStayGatePass(String(bookingId)),
    enabled:  !!bookingId,
    retry:    false,
  });
}
