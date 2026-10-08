import React from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import CardDirectStatusScreen from '@/features/mobility/components/CardDirectStatusScreen';
import { getMoverPaystackStatus } from '@/features/mobility/api/movers.api';
import { moversConfirmedRoute } from '@/features/mobility/utils/moversCardDirect';

// Resolver for a card-direct (Paystack-funded, no wallet, no KYC-tier gate)
// bid acceptance for a move. All behaviour lives in CardDirectStatusScreen; this
// file only says which service it is. Once confirmed, hand off to the normal move
// screen exactly like the wallet path's onPaid does (the job is now bid_accepted
// with the escrow funded). If the bid could no longer be accepted when the charge
// confirmed, the shared screen shows the honest refund copy instead.
export default function MoversPaystackIntentScreen() {
  const { reference } = useLocalSearchParams<{ reference: string }>();
  return (
    <CardDirectStatusScreen
      reference={reference}
      queryKey="movers"
      fetchStatus={getMoverPaystackStatus}
      onConfirmed={(s) => {
        if (s.moveId) router.replace(moversConfirmedRoute(s.moveId) as never);
      }}
      noun="move booking"
      processingText="Confirming your payment and funding your move. This may take a few moments."
      homeRoute="/mobility"
    />
  );
}
