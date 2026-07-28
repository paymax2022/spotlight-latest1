import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useOrders } from '@/features/invest/hooks/useInvest';
import { formatNaira, formatQty, orderStatusLabel, isPositiveStatus } from '@/features/invest/utils/format';

export default function OrdersScreen() {
  const orders = useOrders();
  const data = orders.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Orders" />
      {orders.isLoading ? (
        <StateView kind="loading" />
      ) : orders.isError ? (
        <StateView kind="error" title="Couldn’t load orders" actionLabel="Retry" onAction={() => orders.refetch()} />
      ) : data.length === 0 ? (
        <StateView kind="empty" title="No orders yet" message="Your buy and sell orders will appear here." />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: Spacing.xxl, paddingTop: Spacing.sm }}
          refreshControl={<RefreshControl refreshing={orders.isRefetching} onRefresh={() => orders.refetch()} tintColor={Colors.primary} />}
        >
          {data.map((o) => {
            const isBuy = o.side === 'buy';
            const good = isPositiveStatus(o.status);
            const bad = ['Failed', 'Rejected', 'Cancelled'].includes(o.status);
            const chipColor = bad ? Colors.error : good ? Colors.teal : Colors.onWarning;
            const chipBg = bad ? Colors.errorContainer : good ? Colors.iconBgTeal : Colors.iconBgGold;
            return (
              <View key={o.id} style={[styles.card, shadow1]}>
                <View style={styles.rowTop}>
                  <View>
                    <Text style={styles.sym}>{o.symbol}</Text>
                    <Text style={styles.side}>{isBuy ? 'Buy' : 'Sell'} · {o.order_type}</Text>
                  </View>
                  <View style={[styles.chip, { backgroundColor: chipBg }]}>
                    <Text style={[styles.chipText, { color: chipColor }]}>{orderStatusLabel(o.status)}</Text>
                  </View>
                </View>
                <View style={styles.rowBottom}>
                  <Text style={styles.meta}>{formatQty(o.filled_quantity || o.quantity)} units</Text>
                  <Text style={styles.meta}>
                    {isBuy ? 'Debit ' : 'Proceeds '}{formatNaira(o.total_amount_kobo)}
                  </Text>
                </View>
                {!!o.failure_reason && <Text style={styles.failure}>{o.failure_reason}</Text>}
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  card: {
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sym: { ...Typography.labelLg, color: Colors.onSurface },
  side: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.full },
  chipText: { ...Typography.labelSm },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.sm },
  meta: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  failure: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
});
