// ── Spotlight Realtor — Shortlet hooks (V3) ──────────────────────────────────
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as shortlet from '../api/realtorShortlet.api';
import type { ShortletBookingDraft } from '../api/realtorShortlet.api';

const KEY = 'realtor-shortlet';

export function useShortletQuote(listingId: string, checkIn?: string, checkOut?: string, guests = 1) {
  return useQuery({
    queryKey: [KEY, 'quote', listingId, checkIn, checkOut, guests],
    queryFn: () => shortlet.quoteShortlet(listingId, checkIn!, checkOut!, guests),
    enabled: !!listingId && !!checkIn && !!checkOut,
  });
}

export function useCreateShortletBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: ShortletBookingDraft) => shortlet.createShortletBooking(draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useShortletBooking(id: string) {
  return useQuery({ queryKey: [KEY, 'booking', id], queryFn: () => shortlet.getShortletBooking(id), enabled: !!id });
}
