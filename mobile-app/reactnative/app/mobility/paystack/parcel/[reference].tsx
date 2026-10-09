import React from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import CardDirectStatusScreen from '@/features/mobility/components/CardDirectStatusScreen';
import { getParcelPaystackStatus } from '@/features/mobility/api/parcel.api';

// Resolver for a card-direct (Paystack-funded, no wallet, no KYC-tier gate)
// parcel booking. All behaviour lives in CardDirectStatusScreen; this file only
// says which service it is. Once confirmed, hand off to the normal parcel
// detail screen exactly like the wallet path's onPaid does.
export default function ParcelPaystackIntentScreen() {
  const { reference } = useLocalSearchParams<{ reference: string }>();
  return (
    <CardDirectStatusScreen
      reference={reference}
      queryKey="parcel"
      fetchStatus={getParcelPaystackStatus}
      onConfirmed={(s) => {
        if (s.parcelId) router.replace(`/mobility/parcel/${s.parcelId}` as never);
      }}
      noun="parcel delivery"
      processingText="Confirming your payment and booking your courier. This may take a few moments."
      homeRoute="/mobility"
    />
  );
}
