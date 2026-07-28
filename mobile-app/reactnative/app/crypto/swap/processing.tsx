import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { useAssets, useExecuteSwap } from '@/features/crypto/hooks/useCrypto';
import { buildSwapQuote } from '@/features/crypto/utils/cryptoFormatters';

export default function SwapProcessingScreen() {
  const params = useLocalSearchParams<{ from: string; to: string; amount: string; expiresAt: string }>();
  const assets = useAssets();
  const swap = useExecuteSwap();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current || !assets.data) return;
    const fromAsset = assets.data.find((a) => a.symbol === params.from);
    const toAsset = assets.data.find((a) => a.symbol === params.to);
    if (!fromAsset || !toAsset) return;
    fired.current = true;

    const quote = buildSwapQuote(fromAsset, toAsset, Number(params.amount));
    if (params.expiresAt) quote.expiresAt = String(params.expiresAt);

    swap.mutate(quote, {
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
            from: params.from, to: params.to, amount: params.amount,
            reason: e?.cryptoType === 'quote_expired'
              ? 'The locked rate expired before your swap completed. Please get a fresh quote.'
              : (e?.message ?? 'The swap could not be completed. Your balances are unchanged.'),
            kind: e?.cryptoType === 'quote_expired' ? 'quote_expired' : 'error',
          },
        });
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets.data]);

  if (assets.isError) {
    return (
      <SafeAreaView style={styles.safe}>
        <StateView kind="error" title="Something went wrong" message="We couldn't start your swap. Your balances are unchanged." actionLabel="Back" onAction={() => router.replace('/crypto')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={styles.ring}><ActivityIndicator size="large" color={Colors.primary} /></View>
        <Text style={styles.title}>Swapping your crypto…</Text>
        <Text style={styles.sub}>Filling at the locked rate and posting to your ledger. This only takes a moment — please don't close the app.</Text>
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
