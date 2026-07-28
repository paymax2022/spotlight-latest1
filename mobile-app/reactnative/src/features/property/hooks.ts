// ── Property Management — React Query hooks ──────────────────────────────────
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';
import type { SwitchContextInput } from './types';

export const propertyKeys = {
  all:          ['property'] as const,
  context:      () => [...propertyKeys.all, 'context'] as const,
  rentPassport: () => [...propertyKeys.all, 'rent-passport'] as const,
  gatePass:     (bookingId: string) => [...propertyKeys.all, 'gate-pass', bookingId] as const,
};

/** Active estate/property/agency/org context + the list the user can switch between. */
export function useContext() {
  return useQuery({ queryKey: propertyKeys.context(), queryFn: api.getContext });
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
