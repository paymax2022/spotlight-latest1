import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { useExecuteSwap } from '@/features/crypto/hooks/useCrypto';

export default function SwapProcessingScreen() {
  const params = useLocalSearchParams<{
    from: string; to: string; fromId: string; toId: string; amount: string; quotationId?: string;
  }>();
  const swap = useExecuteSwap();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    // The swap is filled from the trade the member reviewed — the asset pair, the units
    // and, when the exchange issued one, the quotation it agreed to. The server still
    // re-prices both legs; it never trusts the amounts this screen carries.
    swap.mutate(
      {
        fromAssetId: params.fromId,
        toAssetId: params.toId,
        fromUnits: Number(params.amount),
        ...(params.quotationId ? { quotationId: String(params.quotationId) } : {}),
      },
      {
        onSuccess: (res) => {
          router.replace({
            pathname: '/crypto/swap/success',
            params: {
              reference: res.reference, from: res.fromSymbol, to: res.toSymbol,
              fromAmt: String(res.from.amount), toAmt: String(res.to.amount), txId: res.transactionId,
            },
          });
        },
        onError: (err: unknown) => {
          const e = err as { cryptoType?: string; message?: string };
          router.replace({
            pathname: '/crypto/swap/failed',
            params: {
              from: params.from, to: params.to, fromId: params.fromId, toId: params.toId,
              amount: params.amount,
              reason: e?.cryptoType === 'quote_expired'
                ? 'The rate window closed before your swap was placed. Please get a fresh quote.'
                : (e?.message ?? 'The swap could not be completed. Your balances are unchanged.'),
              kind: e?.cryptoType === 'quote_expired' ? 'quote_expired' : 'error',
            },
          });
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={styles.ring}><ActivityIndicator size="large" color={Colors.primary} /></View>
        <Text style={styles.title}>Swapping your crypto…</Text>
        <Text style={styles.sub}>Filling both legs at the live market price and posting them to your ledger. This only takes a moment — please don't close the app.</Text>
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
