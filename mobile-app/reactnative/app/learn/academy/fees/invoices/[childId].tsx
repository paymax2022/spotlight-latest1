import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronRight, Calendar, Layers } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import ProgressBar from '@/features/academy/components/ProgressBar';
import { formatNaira, formatDate, daysUntil } from '@/features/academy/constants';
import { INVOICE_STATUS_META } from '@/features/academy/fees/constants';
import { useInvoices, useFeesChildren } from '@/features/academy/fees/hooks';
import type { Invoice } from '@/features/academy/fees/types';

/** PA-02b — a child's invoices list (entry into PA-03 fee detail). */
export default function ChildInvoices() {
  const { childId } = useLocalSearchParams<{ childId: string }>();
  const invoices = useInvoices(childId);
  const children = useFeesChildren();
  const child = children.data?.find((c) => c.id === childId);

  if (invoices.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Invoices" />
        <StateView kind="loading" message="Loading invoices…" />
      </SafeAreaView>
    );
  }

  const list = invoices.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={child ? `${child.firstName}'s fees` : 'Invoices'} subtitle={child?.schoolName} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {list.length ? list.map((inv) => <InvoiceRow key={inv.id} inv={inv} />) : (
          <StateView kind="empty" icon="ReceiptText" title="No invoices" message="This child has no fee invoices yet." compact />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function InvoiceRow({ inv }: { inv: Invoice }) {
  const meta = INVOICE_STATUS_META[inv.status];
  const outstanding = inv.totalKobo - inv.paidKobo;
  const pct = inv.totalKobo > 0 ? Math.round((inv.paidKobo / inv.totalKobo) * 100) : 0;
  const days = daysUntil(inv.dueDate);
  const urgent = outstanding > 0 && days <= 14;
  return (
    <Pressable style={[styles.card, shadow1]} onPress={() => router.push(`/learn/academy/fees/invoice/${inv.id}`)}>
      <View style={styles.top}>
        <Text style={styles.term} numberOfLines={1}>{inv.term}</Text>
        <Chip label={meta.label} color={meta.color} bg={meta.bg} small />
      </View>
      <Text style={styles.meta}>{inv.classLabel} · Ref {inv.reference}</Text>

      <View style={styles.amountRow}>
        <View>
          <Text style={styles.amountLabel}>{outstanding > 0 ? 'Outstanding' : 'Total (paid)'}</Text>
          <Text style={[styles.amount, outstanding > 0 && { color: Colors.error }]}>
            {formatNaira(outstanding > 0 ? outstanding : inv.totalKobo)}
          </Text>
        </View>
        <ChevronRight size={18} color={Colors.onSurfaceVariant} />
      </View>

      {outstanding > 0 ? (
        <>
          <ProgressBar pct={pct} height={6} color={Colors.teal} style={{ marginTop: 4 }} />
          <View style={styles.footer}>
            <View style={styles.dueRow}>
              <Calendar size={12} color={urgent ? Colors.error : Colors.onSurfaceVariant} />
              <Text style={[styles.dueText, urgent && { color: Colors.error }]}>
                {days >= 0 ? `Due ${formatDate(inv.dueDate)} · ${days}d` : `Overdue by ${-days}d`}
              </Text>
            </View>
            {inv.hasInstallmentPlan ? (
              <View style={styles.planPill}><Layers size={11} color={Colors.secondary} /><Text style={styles.planText}>Plan active</Text></View>
            ) : null}
          </View>
        </>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: 4 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  term: { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  meta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm },
  amountLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  amount: { ...Typography.titleLg, color: Colors.teal },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dueText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  planPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full, backgroundColor: Colors.iconBgBlue },
  planText: { ...Typography.caption, color: Colors.secondary, fontWeight: '700' },
});
