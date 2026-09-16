import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Calendar, Layers, LifeBuoy, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import ProgressBar from '@/features/academy/components/ProgressBar';
import PrimaryButton from '@/components/PrimaryButton';
import { formatNaira, formatDate } from '@/features/academy/constants';
import { INVOICE_STATUS_META, INSTALLMENT_STATUS_META } from '@/features/academy/fees/constants';
import { useInvoice, useInstallmentPlan } from '@/features/academy/fees/hooks';

/** PA-03 / PA-04 — Invoice detail: line items, derived balance (SF-2), installment view, actions. */
export default function InvoiceDetail() {
  const { invoiceId } = useLocalSearchParams<{ invoiceId: string }>();
  const invoice = useInvoice(invoiceId);
  const plan = useInstallmentPlan(invoiceId);

  if (invoice.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Invoice" />
        <StateView kind="loading" message="Loading invoice…" />
      </SafeAreaView>
    );
  }
  if (invoice.isError || !invoice.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Invoice" />
        <StateView kind="error" title="Invoice not found" actionLabel="Go back" onAction={() => goBack('/learn/academy/fees')} />
      </SafeAreaView>
    );
  }

  const inv = invoice.data;
  const meta = INVOICE_STATUS_META[inv.status];
  const outstanding = inv.totalKobo - inv.paidKobo;
  const pct = inv.totalKobo > 0 ? Math.round((inv.paidKobo / inv.totalKobo) * 100) : 0;
  const settled = outstanding <= 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Invoice" subtitle={inv.reference} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header block */}
        <View style={[styles.card, shadow1]}>
          <View style={styles.headRow}>
            <Text style={styles.school} numberOfLines={1}>{inv.schoolName}</Text>
            <Chip label={meta.label} color={meta.color} bg={meta.bg} small />
          </View>
          <Text style={styles.sub}>{inv.childName} · {inv.classLabel} · {inv.term}</Text>

          <View style={styles.balanceBlock}>
            <Text style={styles.balanceLabel}>{settled ? 'Total paid' : 'Outstanding balance'}</Text>
            <Text style={[styles.balance, !settled && { color: Colors.error }]}>
              {formatNaira(settled ? inv.totalKobo : outstanding)}
            </Text>
            {!settled ? <Text style={styles.of}>of {formatNaira(inv.totalKobo)} · {formatNaira(inv.paidKobo)} paid</Text> : null}
          </View>
          <ProgressBar pct={pct} color={Colors.teal} style={{ marginTop: Spacing.sm }} />

          <View style={styles.dueRow}>
            <Calendar size={13} color={Colors.onSurfaceVariant} />
            <Text style={styles.dueText}>Due {formatDate(inv.dueDate)} · issued {formatDate(inv.issuedAt)}</Text>
          </View>
        </View>

        {/* Line items (PA-04) */}
        <Text style={styles.section}>Breakdown</Text>
        <View style={[styles.card, shadow1]}>
          {inv.items.map((li, i) => (
            <View key={li.id} style={[styles.lineRow, i > 0 && styles.lineBorder]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lineLabel}>{li.label}</Text>
                {li.optional ? <Text style={styles.optional}>Optional</Text> : null}
              </View>
              <Text style={styles.lineAmount}>{formatNaira(li.amountKobo)}</Text>
            </View>
          ))}
          <View style={[styles.lineRow, styles.lineBorder, styles.totalRow]}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalAmount}>{formatNaira(inv.totalKobo)}</Text>
          </View>
        </View>

        {/* Installment plan (PA-06 view) */}
        {plan.data ? (
          <>
            <Text style={styles.section}>Installment plan</Text>
            <View style={[styles.card, shadow1]}>
              {!plan.data.disclosureAcceptedAt ? (
                <View style={styles.warnBanner}>
                  <Layers size={16} color={Colors.onWarning} />
                  <Text style={styles.warnText}>Accept the locked terms before your first installment.</Text>
                </View>
              ) : null}
              {plan.data.installments.map((ins) => {
                const im = INSTALLMENT_STATUS_META[ins.status];
                return (
                  <View key={ins.id} style={styles.insRow}>
                    <View style={styles.insSeq}><Text style={styles.insSeqText}>{ins.seq}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.insAmount}>{formatNaira(ins.amountKobo)}</Text>
                      <Text style={styles.insDue}>Due {formatDate(ins.dueDate)}</Text>
                    </View>
                    <Chip label={im.label} color={im.color} bg={im.bg} small />
                  </View>
                );
              })}
              <Pressable style={styles.managePlan} onPress={() => router.push(`/learn/academy/fees/installments/${inv.id}`)}>
                <Text style={styles.manageText}>Manage plan</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {/* Actions */}
        {!settled ? (
          <View style={styles.actions}>
            <PrimaryButton label={`Pay ${formatNaira(outstanding)}`} onPress={() => router.push(`/learn/academy/fees/pay/${inv.id}`)} />
            {inv.installmentEligible && !inv.hasInstallmentPlan ? (
              <PrimaryButton label="Set up installments" variant="secondary" onPress={() => router.push(`/learn/academy/fees/installments/${inv.id}`)} />
            ) : null}
            <Pressable style={styles.hardship} onPress={() => router.push('/learn/academy/fees/hardship')}>
              <LifeBuoy size={16} color={Colors.secondary} />
              <Text style={styles.hardshipText}>Struggling to pay? Request hardship help</Text>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.paidCard, shadow1]}>
            <CheckCircle2 size={20} color={Colors.teal} />
            <Text style={styles.paidText}>This invoice is fully settled.</Text>
            <Pressable onPress={() => router.push('/learn/academy/fees/receipts')}>
              <Text style={styles.paidLink}>View receipts</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  school: { ...Typography.titleLg, color: Colors.onSurface, flex: 1 },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  balanceBlock: { marginTop: Spacing.md },
  balanceLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  balance: { ...Typography.displayLg, color: Colors.teal },
  of: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.sm },
  dueText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.md },
  lineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.sm },
  lineBorder: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  lineLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  optional: { ...Typography.caption, color: Colors.onSurfaceVariant },
  lineAmount: { ...Typography.labelLg, color: Colors.onSurface },
  totalRow: { marginTop: 2 },
  totalLabel: { ...Typography.titleMd, color: Colors.onSurface },
  totalAmount: { ...Typography.titleMd, color: Colors.primary },
  warnBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgGold, borderRadius: Radius.md, padding: Spacing.sm, marginBottom: Spacing.sm },
  warnText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  insRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  insSeq: { width: 26, height: 26, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  insSeqText: { ...Typography.labelSm, color: Colors.onSurface, fontWeight: '700' },
  insAmount: { ...Typography.labelLg, color: Colors.onSurface },
  insDue: { ...Typography.caption, color: Colors.onSurfaceVariant },
  managePlan: { marginTop: Spacing.sm, alignItems: 'center', paddingVertical: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  manageText: { ...Typography.labelMd, color: Colors.secondary, fontWeight: '700' },
  actions: { gap: Spacing.sm, marginTop: Spacing.md },
  hardship: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: Spacing.sm },
  hardshipText: { ...Typography.bodySm, color: Colors.secondary },
  paidCard: { alignItems: 'center', gap: Spacing.xs, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.lg, marginTop: Spacing.md },
  paidText: { ...Typography.titleMd, color: Colors.onSurface },
  paidLink: { ...Typography.labelMd, color: Colors.teal, fontWeight: '700' },
});
