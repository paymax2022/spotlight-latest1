import React, { useEffect } from 'react';
import { Redirect, useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';

/**
 * K0 — automated KYC entry.
 *
 * This file used to render a manual form (document type + number) that put the
 * record in review for a human admin. Verification is now automated via Dojah
 * (identity match, document OCR, selfie liveness, ownership gate), lives at
 * `/kyc-verify`, and is gated behind FEATURE_KYC_VERIFY_ENABLED on the server
 * (see backend/internal/finance/kycverify).
 *
 * Kept as a redirect so legacy deep links (e.g. fractionalre's banner and
 * account menu) land on the Dojah flow instead of the retired manual screen.
 * Query params are forwarded verbatim so a step-up target survives, e.g.
 *   /kyc?target=1  →  /kyc-verify?target=1
 */
export default function KycRedirectScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  // One-shot replace on web, where Redirect sometimes races the layout.
  // On native, Redirect handles it on first render.
  useEffect(() => {
    router.replace({ pathname: '/kyc-verify', params: params as Record<string, string> });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <ScreenHeader title="Verification" />
      <StateView kind="loading" title="Taking you to verification…" />
      {/* Also render Redirect so SSR / snapshot paths don't flash the loader. */}
      <Redirect href={{ pathname: '/kyc-verify', params: params as Record<string, string> }} />
    </SafeAreaView>
  );
}
