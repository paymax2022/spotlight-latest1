import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SegmentedControl from '@/components/SegmentedControl';
import StateView from '@/components/StateView';
import DuesInvoiceRow from '@/features/association/components/DuesInvoiceRow';
import { PaymentStandingBadge } from '@/features/association/components/MembershipStatusBadge';
import { useDues } from '@/features/association/hooks/useAssociation';
import { formatNaira } from '@/features/association/utils/associationFormatters';
import { DUES_SEGMENTS } from '@/features/association/constants/association.constants';

export default function DuesDashboard() {
  const dues = useDues();
  const [filter, setFilter] = useState<string>('all');

  const invoices = useMemo(() => {
    const all = dues.data?.invoices ?? [];
    if (filter === 'all') return all;
    if (filter === 'PAID') return all.filter((i) => i.status === 'PAID');
    return all.filter((i) => i.status === 'DUE' || i.status === 'OVERDUE'); // outstanding
  }, [dues.data, filter]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Dues & subscriptions" />

      {dues.isLoading ? (
        <StateView kind="loading" message="Loading your dues…" />
      ) : dues.isError || !dues.data ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => dues.refetch()} />
      ) : (
        <FlatList
          data={invoices}
          keyExtractor={(i) => i.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.headerArea}>
              {/* Summary card */}
              <View style={[styles.summary, shadow1]}>
                <View style={styles.summaryTop}>
                  <Text style={styles.summaryLabel}>Outstanding balance</Text>
                  <PaymentStandingBadge standing={dues.data.standing} size="sm" />
                </View>
                <Text style={styles.summaryAmount}>{formatNaira(dues.data.outstandingKobo)}</Text>
                <View style={styles.divider} />
                <View style={styles.summaryRow}>
                  <Text style={styles.summarySub}>Paid this year</Text>
                  <Text style={styles.summarySubValue}>{formatNaira(dues.data.paidThisYearKobo)}</Text>
                </View>
              </View>

              <SegmentedControl options={DUES_SEGMENTS as never} value={filter} onChange={setFilter} />
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.rowInset}>
              <DuesInvoiceRow invoice={item} onPress={() => router.push(`/association/pay/${item.id}`)} />
            </View>
          )}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          ListEmptyComponent={
            <StateView kind="empty" compact icon="ReceiptText" title="Nothing here" message="No invoices match this filter." />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingBottom: 120 },
  headerArea: { gap: Spacing.md, marginBottom: Spacing.md },
  summary: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.lg,
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.sm, gap: 4,
  },
  summaryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  // letterSpacing is re-stated because displayLg's -0.96 is tuned to its own
  // 48px (-0.02em). Spreading the style and overriding only the size keeps the
  // ABSOLUTE tracking, which at 36px is -0.027em — tighter than the type scale
  // intends. -0.72 is the same -0.02em at this size.
  summaryAmount: { ...Typography.displayLg, fontSize: 36, lineHeight: 42, letterSpacing: -0.72, color: Colors.onSurface },
  divider: { height: 1, backgroundColor: Colors.outlineVariant, marginVertical: Spacing.sm },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summarySub: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  summarySubValue: { ...Typography.labelMd, color: Colors.teal },
  rowInset: { paddingHorizontal: Spacing.containerMargin },
});
