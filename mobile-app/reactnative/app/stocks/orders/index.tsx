import React, { useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import SegmentedControl from '@/components/SegmentedControl';
import StateView from '@/components/StateView';
import OrderRow from '@/features/stocks/components/OrderRow';
import { useStockOrders } from '@/features/stocks/hooks/useStocks';
import type { OrderSide } from '@/features/stocks/types/stocks.types';

type Filter = 'all' | OrderSide;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'buy', label: 'Buys' },
  { value: 'sell', label: 'Sells' },
];

export default function StockOrdersScreen() {
  const [filter, setFilter] = useState<Filter>('all');
  const orders = useStockOrders(filter === 'all' ? undefined : filter);
  const list = orders.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Stock orders" subtitle="Buys & sells" />

      <View style={styles.filterWrap}>
        <SegmentedControl<Filter> options={FILTERS} value={filter} onChange={setFilter} />
      </View>

      {orders.isLoading ? (
        <StateView kind="loading" message="Loading orders…" />
      ) : orders.isError ? (
        <StateView kind="error" title="Couldn't load orders" message="Please check your connection and try again." actionLabel="Retry" onAction={() => orders.refetch()} />
      ) : list.length === 0 ? (
        <StateView kind="empty" icon="Receipt" title="No orders yet" message="Your stock buys and sells will appear here." actionLabel="Explore stocks" onAction={() => router.push('/stocks/list')} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View style={styles.card}>
            {list.map((o, i, arr) => (
              <View key={o.id}>
                <OrderRow order={o} onPress={() => router.push(`/stocks/orders/${o.id}`)} />
                {i < arr.length - 1 ? <View style={styles.divider} /> : null}
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  filterWrap: { marginVertical: Spacing.md },
  scroll: { paddingBottom: Spacing.xxl },
  card: {
    marginHorizontal: Spacing.containerMargin, backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerLow },
});
