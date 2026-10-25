import React from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import CardDirectStatusScreen from '@/features/mobility/components/CardDirectStatusScreen';
import { getCardCheckoutStatus } from '@/features/events/api';
import type { CardDirectStatusValue } from '@/features/mobility/utils/cardDirect';

// Resolver for the events card rail (EVTB-D013): the Paystack SDK hand-off
// lands here and the screen polls GET /api/finance/events/card/:ref/status —
// which re-verifies the charge server-side (the webhook may not have arrived).
// Reuses the shared card-direct resolver screen; 'expired' (the seat hold was
// released unpaid, or a late charge is being refunded) maps onto its failed
// vocabulary — every other status means the same thing on both rails.
export default function EventCardStatus() {
  const { reference, eventId } = useLocalSearchParams<{ reference?: string; eventId?: string }>();
  return (
    <CardDirectStatusScreen
      reference={reference}
      queryKey="event-ticket"
      noun="ticket"
      processingText="Confirming your card payment — your tickets appear here as soon as it clears."
      homeRoute="/events"
      fetchStatus={async (ref) => {
        const r = await getCardCheckoutStatus(ref);
        const status: CardDirectStatusValue = r.status === 'expired' ? 'order_failed' : r.status;
        return { reference: r.reference, status, amountKobo: r.amountKobo, ticketCount: r.tickets.length };
      }}
      onConfirmed={(s) => {
        router.replace({
          pathname: '/events/checkout/success',
          params: { count: String(s.ticketCount ?? 1), eventId: eventId ?? '' },
        });
      }}
    />
  );
}
