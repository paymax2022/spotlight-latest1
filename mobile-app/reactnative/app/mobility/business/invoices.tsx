import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useInvoices } from '@/features/mobility/hooks/useLogistics';
import { LOGISTICS_ENABLED, INVOICE_STATUS_LABEL } from '@/features/mobility/constants/modes.constants';
import { formatNaira } from '@/features/mobility/utils/mobilityFormatters';
import type { BusinessInvoice, InvoiceStatus } from '@/features/mobility/types/logistics.types';

const d = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

function tone(s: InvoiceStatus) {
  if (s === 'paid') return 'success' as const;
  if (s === 'overdue') return 'danger' as const;
  if (s === 'issued') return 'info' as const;
  return 'neutral' as const;
}

export default function InvoicesScreen() {
  const invoices = useInvoices();

  if (!LOGISTICS_ENABLED) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Invoices" />
        <MobilityEdgeState kind="serviceUnavailable" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Invoices" />
      {invoices.isLoading ? (
        <StateView kind="loading" message="Loading invoices…" />
      ) : invoices.isError ? (
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => invoices.refetch()} />
      ) : (invoices.data ?? []).length === 0 ? (
        <MobilityEdgeState kind="empty" title="No invoices yet" message="Monthly invoices appear here once your billing period closes." />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={invoices.isRefetching} onRefresh={() => invoices.refetch()} tintColor={Colors.primary} />}
        >
          {invoices.data!.map((inv) => (
            <Card key={inv.id} inv={inv} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Card({ inv }: { inv: BusinessInvoice }) {
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.period}>{inv.periodLabel}</Text>
          <Text style={styles.count}>{inv.deliveryCount} deliveries</Text>
        </View>
        <StatusBadge label={INVOICE_STATUS_LABEL[inv.status]} tone={tone(inv.status)} />
      </View>
      <Text style={styles.amount}>{formatNaira(inv.amountKobo)}</Text>
      <View style={styles.dates}>
        <Text style={styles.dateText}>Issued {d(inv.issuedAt)}</Text>
        <Text style={styles.dateText}>Due {d(inv.dueAt)}</Text>
        {inv.paidAt ? <Text style={styles.dateText}>Paid {d(inv.paidAt)}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant, gap: Spacing.sm },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  period: { ...Typography.titleMd, color: Colors.onSurface },
  count: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  amount: { ...Typography.titleLg, color: Colors.primary, fontWeight: '800' as const },
  dates: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  dateText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
