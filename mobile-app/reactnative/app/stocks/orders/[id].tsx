import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Copy, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import StockIcon from '@/features/stocks/components/StockIcon';
import OrderStatusBadge from '@/features/stocks/components/OrderStatusBadge';
import { useStockOrder, useCancelOrder } from '@/features/stocks/hooks/useStocks';
import { formatMoneyObj, formatShares, formatDateTime } from '@/features/stocks/utils/stockFormatters';
import { SIDE_LABEL, STOCK_FEE_LABEL, SETTLEMENT_NOTE } from '@/features/stocks/constants/stocks.constants';
import type { StockOrderStatus } from '@/features/stocks/types/stocks.types';

const CANCELLABLE: StockOrderStatus[] = ['AwaitingUserConfirmation', 'Submitted', 'AcceptedByProvider'];

export default function StockOrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useStockOrder(id);
  const cancel = useCancelOrder();

  if (order.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Order" />
        <StateView kind="loading" message="Loading order…" />
      </SafeAreaView>
    );
  }
  if (order.isError || !order.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Order" />
        <StateView kind="error" title="Couldn't load order" message="This order could not be found." actionLabel="Retry" onAction={() => order.refetch()} />
      </SafeAreaView>
    );
  }

  const o = order.data;
  const isLimit = o.orderType === 'limit';
  const cancellable = CANCELLABLE.includes(o.status);
  const showFailure = (o.status === 'Failed' || o.status === 'Rejected') && !!o.failureReason;

  const onCancel = () => {
    cancel.mutate(id, { onSuccess: () => order.refetch() });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Order" subtitle={o.reference} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Hero */}
        <View style={styles.hero}>
          <StockIcon symbol={o.symbol} color={Colors.primary} size={48} />
          <Text style={styles.heroTitle}>{SIDE_LABEL[o.side]} {formatShares(o.quantity)} {o.symbol}</Text>
          <Text style={styles.heroAmount}>{formatMoneyObj(o.total)}</Text>
          <OrderStatusBadge status={o.status} />
        </View>

        {showFailure ? (
          <View style={styles.failBox}>
            <Text style={styles.failText}>{o.failureReason}</Text>
          </View>
        ) : null}

        {/* Summary */}
        <View style={styles.card}>
          <Row label="Type" value={isLimit ? 'Limit order' : 'Market order'} />
          <Row label="Quantity" value={formatShares(o.quantity)} />
          <Row label="Filled" value={formatShares(o.filledQuantity)} />
          {isLimit && o.limitPrice ? (
            <Row label="Limit price" value={`${formatMoneyObj(o.limitPrice)} / share`} />
          ) : (
            <Row label="Price" value={`${formatMoneyObj(o.price)} / share`} />
          )}
          <View style={styles.divider} />
          <Row label="Gross" value={formatMoneyObj(o.gross)} />
          {o.fees.filter((f) => f.amount.amount > 0).map((f) => (
            <Row key={f.type} label={STOCK_FEE_LABEL[f.type] ?? f.type} value={formatMoneyObj(f.amount)} muted />
          ))}
          <View style={styles.divider} />
          <Row label="Total" value={formatMoneyObj(o.total)} emphasis />
          {o.settlementDate ? <Row label="Settlement date" value={formatDateTime(o.settlementDate)} /> : null}
        </View>

        {o.settlementDate ? (
          <Text style={styles.note}>{SETTLEMENT_NOTE}</Text>
        ) : null}

        {/* Status timeline */}
        <Text style={styles.sectionTitle}>Status</Text>
        <View style={styles.card}>
          {o.statusHistory.map((s, i) => (
            <View key={`${s.status}-${i}`} style={styles.timelineRow}>
              <View style={styles.timelineDotWrap}>
                <View style={[styles.timelineDot, i === o.statusHistory.length - 1 && styles.timelineDotActive]} />
                {i < o.statusHistory.length - 1 ? <View style={styles.timelineLine} /> : null}
              </View>
              <View style={styles.timelineBody}>
                <OrderStatusBadge status={s.status} size="sm" />
                <Text style={styles.timelineAt}>{formatDateTime(s.at)}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Provider traceability */}
        <Text style={styles.sectionTitle}>Details</Text>
        <View style={styles.card}>
          <Row label="Reference" value={o.reference} copyable />
          <Row label="Date" value={formatDateTime(o.createdAt)} />
          <Row label="Provider reference" value={o.providerReference} copyable />
          <Row label="Provider" value={o.provider} />
        </View>

        {cancellable ? (
          <View style={styles.cancelWrap}>
            <PrimaryButton label="Cancel order" variant="danger" loading={cancel.isPending} onPress={onCancel} />
          </View>
        ) : null}

        <View style={styles.secureNote}>
          <ShieldCheck size={15} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.secureText}>
            Every order is recorded against a provider reference and a double-entry ledger record, so your balances always reconcile.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, emphasis, muted, copyable }: { label: string; value: string; emphasis?: boolean; muted?: boolean; copyable?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, muted && styles.rowMuted]}>{label}</Text>
      <View style={styles.rowRight}>
        <Text style={[styles.rowValue, emphasis && styles.rowEmphasis, muted && styles.rowMutedValue]} numberOfLines={1}>{value}</Text>
        {copyable ? <Copy size={13} color={Colors.outline} strokeWidth={2} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.md },
  hero: {
    alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingVertical: Spacing.lg, gap: 6,
  },
  heroTitle: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  heroAmount: { ...Typography.headlineMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  failBox: { backgroundColor: Colors.errorContainer, borderRadius: Radius.lg, padding: Spacing.md },
  failText: { ...Typography.labelMd, color: Colors.error, lineHeight: 18 },
  card: {
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurface, flexShrink: 0 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  rowValue: { ...Typography.labelMd, color: Colors.onSurface, textAlign: 'right' },
  rowEmphasis: { ...Typography.labelLg, color: Colors.primary },
  rowMuted: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rowMutedValue: { color: Colors.onSurfaceVariant },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: 2 },
  note: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 18, paddingHorizontal: Spacing.xs },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  timelineRow: { flexDirection: 'row', gap: Spacing.md },
  timelineDotWrap: { alignItems: 'center', width: 12 },
  timelineDot: { width: 10, height: 10, borderRadius: Radius.full, backgroundColor: Colors.outlineVariant, marginTop: 4 },
  timelineDotActive: { backgroundColor: Colors.primary },
  timelineLine: { flex: 1, width: 2, backgroundColor: Colors.surfaceContainerHigh, marginVertical: 2 },
  timelineBody: { flex: 1, gap: 4, paddingBottom: Spacing.md },
  timelineAt: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  cancelWrap: { marginTop: Spacing.xs },
  secureNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: Spacing.xs },
  secureText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 18 },
});
