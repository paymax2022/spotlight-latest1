import React from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import CardDirectStatusScreen from '@/features/mobility/components/CardDirectStatusScreen';
import { getCarHirePaystackStatus } from '@/features/mobility/api/carhire.api';

// Resolver for a card-direct (Paystack-funded, no wallet, no KYC-tier gate)
// car-hire booking: ONE charge covering fare + refundable deposit. All behaviour
// lives in CardDirectStatusScreen; this file only says which service it is. Once
// confirmed, hand off to the normal booking screen exactly like the wallet
// path's onPaid does.
export default function CarHirePaystackIntentScreen() {
  const { reference } = useLocalSearchParams<{ reference: string }>();
  return (
    <CardDirectStatusScreen
      reference={reference}
      queryKey="carhire"
      fetchStatus={getCarHirePaystackStatus}
      onConfirmed={(s) => {
        if (s.bookingId) router.replace(`/mobility/carhire/${s.bookingId}` as never);
      }}
      noun="car hire booking"
      processingText="Confirming your payment and booking your car. This may take a few moments."
      homeRoute="/mobility"
    />
  );
}
