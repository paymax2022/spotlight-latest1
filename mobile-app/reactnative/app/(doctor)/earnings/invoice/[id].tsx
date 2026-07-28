import React from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Receipt } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { formatKobo } from '@/api/doctor.batch6.api';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, StatusBadge } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { useInvoices } from '@/features/doctor/hooks';
import { INVOICE_STATUS_LABELS } from '@/features/doctor/constants';
import type { InvoiceStatus } from '@/types/doctor.batch6';

const STATUS_TONE: Record<InvoiceStatus, StatusTone> = {
  draft:  'neutral',
  issued: 'info',
  paid:   'success',
  void:   'danger',
};

// Y.18: invoice detail. Reuses useInvoices (no single-invoice endpoint); finds
// the invoice by id from the list (placeholderData seeds it instantly).
export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: invoices, isLoading, isError, refetch } = useInvoices();
  const invoice = invoices?.find((i) => i.id === String(id));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Invoice" />

      {isLoading && !invoices ? (
        <StateView variant="loading" label="Loading invoice" />
      ) : isError ? (
        <StateView variant="error" message="We could not load this invoice." onRetry={() => refetch()} />
      ) : !invoice ? (
        <StateView variant="empty" icon={Receipt} title="Invoice not found" message="This invoice is no longer available." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.headerRow}>
            <View style={styles.headerBody}>
              <Text style={styles.ref}>{invoice.ref}</Text>
              <Text style={styles.period}>{invoice.periodLabel} · issued {new Date(invoice.issuedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
            </View>
            <StatusBadge label={INVOICE_STATUS_LABELS[invoice.status]} tone={STATUS_TONE[invoice.status]} />
          </View>

          <SectionCard title="Line items" style={styles.card}>
            {invoice.lineItems.map((li, i) => (
              <View key={i} style={[styles.lineRow, i > 0 && styles.border]}>
                <View style={styles.lineBody}>
                  <Text style={styles.lineDesc} numberOfLines={2}>{li.description}</Text>
                  <Text style={styles.lineMeta}>{li.quantity} × {formatKobo(li.unitKobo)}</Text>
                </View>
                <Text style={styles.lineAmount}>{formatKobo(li.amountKobo)}</Text>
              </View>
            ))}
          </SectionCard>

          <SectionCard title="Totals" style={styles.card}>
            <InfoRow label="Subtotal" value={formatKobo(invoice.subtotalKobo)} />
            <InfoRow label="VAT" value={formatKobo(invoice.vatKobo)} />
            <InfoRow label="Total" value={formatKobo(invoice.totalKobo)} valueColor={Colors.teal} />
          </SectionCard>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24, gap: Spacing.md },
  headerRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  headerBody: { flex: 1, gap: 2 },
  ref:        { ...Typography.headlineMd, color: Colors.onSurface },
  period:     { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  card:       { marginBottom: 0 },
  lineRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: Spacing.sm },
  border:     { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  lineBody:   { flex: 1, gap: 2 },
  lineDesc:   { ...Typography.labelMd, color: Colors.onSurface },
  lineMeta:   { ...Typography.caption, color: Colors.onSurfaceVariant },
  lineAmount: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' },
});
