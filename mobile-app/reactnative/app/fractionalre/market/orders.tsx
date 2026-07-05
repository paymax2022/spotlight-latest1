import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useMarketOrders } from '@/features/fractionalre/hooks';
import { formatNaira, relativeDate } from '@/features/fractionalre/utils';

const STATUS_COLOR: Record<string, string> = {
  open: Colors.secondary, matched: Colors.onWarning, filled: Colors.teal, cancelled: Colors.onSurfaceVariant, expired: Colors.onSurfaceVariant,
};

export default function MarketOrdersScreen() {
  const orders = useMarketOrders();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My market orders" />
      {orders.isLoading ? (
        <StateView kind="loading" message="Loading orders…" />
      ) : (orders.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" title="No orders yet" message="Your buy and sell orders on the secondary market appear here." icon="ClipboardList" />
      ) : (
        <FlatList
          data={orders.data}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const isBuy = item.side === 'buy';
            const Icon = isBuy ? ArrowDownLeft : ArrowUpRight;
            return (
              <View style={styles.row}>
                <View style={[styles.iconBox, { backgroundColor: isBuy ? Colors.iconBgTeal : Colors.iconBgBlue }]}>
                  <Icon size={18} color={isBuy ? Colors.teal : Colors.secondary} strokeWidth={2} />
                </View>
                <View style={styles.text}>
                  <Text style={styles.title} numberOfLines={1}>{item.offeringTitle}</Text>
                  <Text style={styles.sub}>{item.side} · {item.units} units · {relativeDate(item.createdAt)}</Text>
                </View>
                <View style={styles.right}>
                  <Text style={styles.amount}>{formatNaira(item.amountKobo)}</Text>
                  <Text style={[styles.status, { color: STATUS_COLOR[item.status] }]}>{item.status}</Text>
                </View>
              </View>
            );
          }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'capitalize' },
  right: { alignItems: 'flex-end' },
  amount: { ...Typography.labelLg, color: Colors.onSurface },
  status: { ...Typography.labelSm, fontWeight: '600', textTransform: 'capitalize' },
});
