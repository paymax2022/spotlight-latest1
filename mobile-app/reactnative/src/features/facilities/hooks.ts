import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generateIdempotencyKey } from '@/utils/idempotency';
import * as api from './api';
import type { CreateBookingInput } from './api';

export const facilityKeys = {
  all: ['facilities'] as const,
  list: () => [...facilityKeys.all, 'list'] as const,
  bookings: () => [...facilityKeys.all, 'bookings'] as const,
};

export function useFacilities() { return useQuery({ queryKey: facilityKeys.list(), queryFn: api.listFacilities }); }
export function useMyBookings() { return useQuery({ queryKey: facilityKeys.bookings(), queryFn: api.listMyBookings }); }

export function useCreateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreateBookingInput, 'idempotencyKey'>) => api.createBooking({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: facilityKeys.bookings() }),
  });
}
export function useCancelBooking() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.cancelBooking(id), onSuccess: () => qc.invalidateQueries({ queryKey: facilityKeys.bookings() }) });
}
