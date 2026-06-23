import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { useQuoteWithdrawal, useInitiateWithdrawal } from '@/features/crypto/hooks/useCrypto';
import type { WithdrawalDraft } from '@/features/crypto/types/crypto.types';

export default function WithdrawProcessingScreen() {
  const p = useLocalSearchParams<{ assetId: string; symbol: string; networkId: string; addressId: string; amount: string; otp: string }>();
  const quoteM = useQuoteWithdrawal();
  const initiate = useInitiateWithdrawal();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const draft: WithdrawalDraft = {
      assetId: p.assetId, symbol: p.symbol, networkId: p.networkId,
      addressId: p.addressId, amount: Number(p.amount),
    };
    quoteM.mutateAsync(draft)
      .then((quote) => initiate.mutateAsync({ draft, quote, otp: p.otp ?? '' }))
      .then((result) => {
        router.replace({
          pathname: '/crypto/withdraw/pending',
          params: {
            reference: result.reference, symbol: result.symbol,
            amount: String(result.amount.amount), address: result.address,
            networkName: result.networkName, mins: String(result.estimatedReviewMins),
          },
        });
      })
      .catch((err: unknown) => {
        const e = err as { message?: string };
        router.replace({
          pathname: '/crypto/withdraw/failed',
          params: { reason: e?.message ?? 'The withdrawal could not be submitted. Your balance is unchanged.' },
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (initiate.isError || quoteM.isError) {
    return (
      <SafeAreaView style={styles.safe}>
        <StateView kind="error" title="Something went wrong" message="We couldn't submit your withdrawal. Your balance is unchanged." actionLabel="Back" onAction={() => router.replace('/crypto')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={styles.ring}><ActivityIndicator size="large" color={Colors.primary} /></View>
        <Text style={styles.title}>Submitting your withdrawal…</Text>
        <Text style={styles.sub}>Running security and compliance checks and locking your balance. Please don't close the app.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  ring: { width: 104, height: 104, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
