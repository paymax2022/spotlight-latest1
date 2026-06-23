import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { useAsset, useExecuteBuy } from '@/features/crypto/hooks/useCrypto';
import { buildQuote } from '@/features/crypto/utils/cryptoFormatters';
import type { AmountBasis } from '@/features/crypto/types/crypto.types';

export default function BuyProcessingScreen() {
  const params = useLocalSearchParams<{ symbol: string; basis: string; amount: string; expiresAt: string }>();
  const asset = useAsset(params.symbol);
  const buy = useExecuteBuy();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current || !asset.data) return;
    fired.current = true;
    const quote = buildQuote(asset.data, {
      assetId: asset.data.id, side: 'buy',
      basis: (params.basis as AmountBasis) ?? 'fiat',
      amount: Number(params.amount), currency: 'NGN', lock: true,
    });
    // Preserve the (possibly already-expired) lock window from the review screen.
    if (params.expiresAt) quote.expiresAt = String(params.expiresAt);

    buy.mutate(quote, {
      onSuccess: (order) => {
        router.replace({
          pathname: '/crypto/buy/success',
          params: {
            reference: order.reference, symbol: order.symbol,
            crypto: String(order.crypto.amount), fiat: String(order.totalFiat.amount),
            txId: order.transactionId,
          },
        });
      },
      onError: (err: unknown) => {
        const e = err as { cryptoType?: string; message?: string };
        router.replace({
          pathname: '/crypto/buy/failed',
          params: {
            symbol: params.symbol, basis: params.basis, amount: params.amount,
            reason: e?.cryptoType === 'quote_expired'
              ? 'The locked price expired before your order was filled. Please get a fresh quote.'
              : (e?.message ?? 'The order could not be completed. No funds were debited.'),
            kind: e?.cryptoType === 'quote_expired' ? 'quote_expired' : 'error',
          },
        });
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.data]);

  if (asset.isError) {
    return (
      <SafeAreaView style={styles.safe}>
        <StateView kind="error" title="Something went wrong" message="We couldn't start your order. No funds were debited." actionLabel="Back" onAction={() => router.replace('/crypto')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={styles.ring}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
        <Text style={styles.title}>Placing your order…</Text>
        <Text style={styles.sub}>Filling at the locked price and posting to your ledger. This only takes a moment — please don't close the app.</Text>
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
