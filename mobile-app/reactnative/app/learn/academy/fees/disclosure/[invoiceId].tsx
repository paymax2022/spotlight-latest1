import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Lock, Check, FileText } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { formatNaira, formatDate } from '@/features/academy/constants';
import { INSTALLMENT_DISCLOSURE_COPY } from '@/features/academy/fees/constants';
import { useInvoice, useInstallmentPlan, useAcceptDisclosure } from '@/features/academy/fees/hooks';
import { alertAsync } from '@/lib/confirm';

/**
 * PA-06 · SF-6 — Mandatory installment DISCLOSURE screen, shown BEFORE the first
 * installment payment. The plan's locked terms are displayed verbatim; the parent
 * must tick the acknowledgement, which records disclosureAcceptedAt server-side.
 * Only then does the installments screen unlock the first payment.
 */
export default function InstallmentDisclosure() {
  const { invoiceId } = useLocalSearchParams<{ invoiceId: string }>();
  const invoice = useInvoice(invoiceId);
  const plan = useInstallmentPlan(invoiceId);
  const accept = useAcceptDisclosure();
  const [acked, setAcked] = useState(false);

  if (invoice.isLoading || plan.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Installment terms" />
        <StateView kind="loading" message="Loading terms…" />
      </SafeAreaView>
    );
  }
  if (!plan.data || !invoice.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Installment terms" />
        <StateView kind="error" title="No plan to disclose" message="Set up an installment plan first." actionLabel="Go back" onAction={() => goBack('/learn/academy/fees')} />
      </SafeAreaView>
    );
  }

  const p = plan.data;
  const inv = invoice.data;

  const onAccept = () => {
    if (!acked) return;
    accept.mutate(invoiceId as string, {
      onSuccess: () => {
        alertAsync({ title: 'Terms accepted', message: 'Your installment plan is now active. You can pay the first installment.', buttonLabel: 'Continue' }).then(() => router.replace(`/learn/academy/fees/installments/${inv.id}`));
      },
      onError: (e) => alertAsync({ title: 'Could not record acceptance', message: (e as Error).message }),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Installment terms" subtitle="SF-6 · Please read" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><FileText size={24} color={Colors.primary} /></View>
          <Text style={styles.heroTitle}>Review your installment plan</Text>
        </View>

        {/* Locked terms */}
        <View style={[styles.disclosure, shadow1]}>
          <Text style={styles.disclosureText}>{INSTALLMENT_DISCLOSURE_COPY}</Text>
        </View>

        {/* Locked schedule */}
        <View style={styles.scheduleHead}>
          <Lock size={14} color={Colors.onSurfaceVariant} />
          <Text style={styles.scheduleTitle}>Locked schedule · {inv.schoolName}</Text>
        </View>
        <View style={[styles.card, shadow1]}>
          {p.installments.map((ins, i) => (
            <View key={ins.id} style={[styles.row, i > 0 && styles.rowBorder]}>
              <Text style={styles.rowSeq}>Payment {ins.seq}</Text>
              <View style={styles.rowRight}>
                <Text style={styles.rowAmount}>{formatNaira(ins.amountKobo)}</Text>
                <Text style={styles.rowDue}>by {formatDate(ins.dueDate)}</Text>
              </View>
            </View>
          ))}
          <View style={[styles.row, styles.rowBorder]}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalAmount}>{formatNaira(p.totalKobo)}</Text>
          </View>
        </View>

        {/* Acknowledgement */}
        <Pressable style={styles.ackRow} onPress={() => setAcked((v) => !v)}>
          <View style={[styles.checkbox, acked && styles.checkboxOn]}>
            {acked ? <Check size={15} color={Colors.onPrimary} strokeWidth={3} /> : null}
          </View>
          <Text style={styles.ackText}>I have read and accept these locked installment terms.</Text>
        </Pressable>

        <PrimaryButton
          label="Accept & activate plan"
          onPress={onAccept}
          disabled={!acked}
          loading={accept.isPending}
          style={{ marginTop: Spacing.sm }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  hero: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  heroIcon: { width: 56, height: 56, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple },
  heroTitle: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  disclosure: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  disclosureText: { ...Typography.bodyMd, color: Colors.onSurface, lineHeight: 22 },
  scheduleHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.md },
  scheduleTitle: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.sm },
  rowBorder: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  rowSeq: { ...Typography.bodyMd, color: Colors.onSurface },
  rowRight: { alignItems: 'flex-end' },
  rowAmount: { ...Typography.labelLg, color: Colors.onSurface },
  rowDue: { ...Typography.caption, color: Colors.onSurfaceVariant },
  totalLabel: { ...Typography.titleMd, color: Colors.onSurface },
  totalAmount: { ...Typography.titleMd, color: Colors.primary },
  ackRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm, marginTop: Spacing.xs },
  checkbox: { width: 24, height: 24, borderRadius: Radius.sm, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  ackText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
});
