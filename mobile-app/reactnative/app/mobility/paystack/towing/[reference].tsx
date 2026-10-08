import React from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import CardDirectStatusScreen from '@/features/mobility/components/CardDirectStatusScreen';
import { getTowingPaystackStatus } from '@/features/mobility/api/towing.api';

// Resolver for a card-direct (Paystack-funded, no wallet, no KYC-tier gate)
// towing booking. All behaviour lives in CardDirectStatusScreen; this file only
// says which service it is. Once confirmed, hand off to the normal towing job
// screen exactly like the wallet path's onPaid does.
export default function TowingPaystackIntentScreen() {
  const { reference } = useLocalSearchParams<{ reference: string }>();
  return (
    <CardDirectStatusScreen
      reference={reference}
      queryKey="towing"
      fetchStatus={getTowingPaystackStatus}
      onConfirmed={(s) => {
        if (s.towingJobId) router.replace(`/mobility/towing/${s.towingJobId}` as never);
      }}
      noun="tow & rescue request"
      processingText="Confirming your payment and finding you an operator. This may take a few moments."
      homeRoute="/mobility"
    />
  );
}
