import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { useStock, usePlaceOrder } from '@/features/stocks/hooks/useStocks';
import type { OrderType } from '@/features/stocks/types/stocks.types';

export default function StockSellProcessingScreen() {
  const params = useLocalSearchParams<{ symbol: string; orderType: string; quantity: string; limitPrice?: string }>();
  const asset = useStock(params.symbol);
  const place = usePlaceOrder();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current || !asset.data) return;
    fired.current = true;
    const a = asset.data;
    const orderType = (params.orderType as OrderType) ?? 'market';
    const limitPrice = params.limitPrice ? Number(params.limitPrice) : undefined;

    place.mutate(
      {
        assetId: a.id, symbol: a.symbol, side: 'sell', orderType,
        quantity: Number(params.quantity),
        ...(limitPrice ? { limitPrice } : {}),
      },
      {
        onSuccess: (order) => {
          router.replace({
            pathname: '/stocks/sell/success',
            params: {
              reference: order.reference, symbol: order.symbol,
              quantity: String(order.quantity), total: String(order.total.amount),
              status: order.status, orderType, txId: order.id,
            },
          });
        },
        onError: (err: unknown) => {
          const e = err as { stockType?: string; message?: string };
          router.replace({
            pathname: '/stocks/sell/failed',
            params: {
              symbol: params.symbol, orderType, quantity: params.quantity,
              ...(params.limitPrice ? { limitPrice: params.limitPrice } : {}),
              reason: e?.message ?? 'The order could not be completed. No shares were sold.',
              kind: e?.stockType ?? 'error',
            },
          });
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.data]);

  if (asset.isError) {
    return (
      <SafeAreaView style={styles.safe}>
        <StateView kind="error" title="Something went wrong" message="We couldn't start your order. No shares were sold." actionLabel="Back" onAction={() => router.replace('/stocks')} />
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
        <Text style={styles.sub}>Routing to the exchange and posting to your ledger. This only takes a moment — please don't close the app.</Text>
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
