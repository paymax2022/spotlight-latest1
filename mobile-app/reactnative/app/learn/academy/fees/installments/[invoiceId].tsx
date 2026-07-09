import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2, Lock, ShieldAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import Chip from '@/features/academy/components/Chip';
import { formatNaira, formatDate } from '@/features/academy/constants';
import { INSTALLMENT_PLANS, INSTALLMENT_STATUS_META } from '@/features/academy/fees/constants';
import {
  useInvoice, useInstallmentPlan, useCreateInstallmentPlan, usePayInstallment,
} from '@/features/academy/fees/hooks';

/**
 * PA-06 — Installment setup + manage. Creating a plan locks the terms (SF-1/SF-6).
 * The FIRST installment cannot be paid until the SF-6 disclosure is acknowledged,
 * which happens on the dedicated disclosure screen we route to here.
 */
export default function InstallmentSetup() {
  const { invoiceId } = useLocalSearchParams<{ invoiceId: string }>();
  const invoice = useInvoice(invoiceId);
  const plan = useInstallmentPlan(invoiceId);
  const create = useCreateInstallmentPlan();
  const payInstallment = usePayInstallment();
  const [count, setCount] = useState(3);

  if (invoice.isLoading || plan.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Installments" />
        <StateView kind="loading" message="Loading plan…" />
      </SafeAreaView>
    );
  }
  if (!invoice.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Installments" />
        <StateView kind="error" title="Invoice not found" actionLabel="Go back" onAction={() => router.back()} />
      </SafeAreaView>
    );
  }

  const inv = invoice.data;
  const outstanding = inv.totalKobo - inv.paidKobo;

  // ── Existing plan → manage view ──
  if (plan.data) {
    const p = plan.data;
    const disclosed = !!p.disclosureAcceptedAt;
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Installment plan" subtitle={inv.reference} />
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={[styles.lockCard, shadow1]}>
            <Lock size={16} color={Colors.onSurfaceVariant} />
            <Text style={styles.lockText}>These {p.count} installments and dates are locked (SF-6). They cannot change once the plan begins.</Text>
          </View>

          {!disclosed ? (
            <View style={[styles.discloseBanner, shadow1]}>
              <ShieldAlert size={18} color={Colors.onWarning} />
              <View style={{ flex: 1 }}>
                <Text style={styles.discloseTitle}>Review the terms first</Text>
                <Text style={styles.discloseSub}>You must accept the installment terms before the first payment.</Text>
              </View>
            </View>
          ) : null}

          {p.installments.map((ins) => {
            const im = INSTALLMENT_STATUS_META[ins.status];
            const payable = disclosed && (ins.status === 'due');
            return (
              <View key={ins.id} style={[styles.card, shadow1]}>
                <View style={styles.insTop}>
                  <View style={styles.insSeq}><Text style={styles.insSeqText}>{ins.seq}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.insAmount}>{formatNaira(ins.amountKobo)}</Text>
                    <Text style={styles.insDue}>Due {formatDate(ins.dueDate)}</Text>
                  </View>
                  <Chip label={im.label} color={im.color} bg={im.bg} small />
                </View>
                {payable ? (
                  <PrimaryButton
                    label={`Pay installment ${ins.seq}`}
                    onPress={() => payInstallment.mutate(
                      { invoiceId: inv.id, installmentId: ins.id, method: 'wallet' },
                      { onError: (e) => Alert.alert('Payment failed', (e as Error).message) },
                    )}
                    loading={payInstallment.isPending}
                    style={{ marginTop: Spacing.sm }}
                  />
                ) : null}
              </View>
            );
          })}

          {!disclosed ? (
            <PrimaryButton
              label="Review & accept terms"
              onPress={() => router.push(`/learn/academy/fees/disclosure/${inv.id}`)}
              style={{ marginTop: Spacing.md }}
            />
          ) : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── No plan yet → setup view ──
  const per = Math.round(outstanding / count);
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Set up installments" subtitle={inv.reference} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.card, shadow1]}>
          <Text style={styles.school}>{inv.schoolName}</Text>
          <Text style={styles.sub}>{inv.childName} · {inv.term}</Text>
          <Text style={styles.outLabel}>Balance to spread</Text>
          <Text style={styles.out}>{formatNaira(outstanding)}</Text>
        </View>

        {/* Model-A note: guardian pays school over time — Paymax never fronts fees. */}
        <View style={[styles.modelNote, shadow1]}>
          <Text style={styles.modelText}>You pay the school directly over time. Paymax does not lend you the money or advance it to the school.</Text>
        </View>

        <Text style={styles.section}>Choose a plan</Text>
        {INSTALLMENT_PLANS.map((pl) => {
          const active = count === pl.value;
          const approx = Math.round(outstanding / pl.value);
          return (
            <Pressable key={pl.value} style={[styles.planOpt, shadow1, active && styles.planActive]} onPress={() => setCount(pl.value)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.planLabel}>{pl.label}</Text>
                <Text style={styles.planHint}>{pl.hint} · ~{formatNaira(approx)} each</Text>
              </View>
              {active ? <CheckCircle2 size={20} color={Colors.primary} /> : <View style={styles.radio} />}
            </Pressable>
          );
        })}

        <View style={styles.previewRow}>
          <Text style={styles.previewLabel}>{count} payments of about</Text>
          <Text style={styles.previewAmount}>{formatNaira(per)}</Text>
        </View>

        <PrimaryButton
          label="Create plan"
          onPress={() => create.mutate(
            { invoiceId: inv.id, count },
            {
              onSuccess: () => router.replace(`/learn/academy/fees/disclosure/${inv.id}`),
              onError: (e) => Alert.alert('Could not create plan', (e as Error).message),
            },
          )}
          loading={create.isPending}
          style={{ marginTop: Spacing.md }}
        />
        <Text style={styles.footNote}>Next: review and accept the locked terms before your first installment (SF-6).</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  school: { ...Typography.titleMd, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  outLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  out: { ...Typography.headlineMd, color: Colors.onSurface },
  lockCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  lockText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  discloseBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgGold, borderRadius: Radius.lg, padding: Spacing.md },
  discloseTitle: { ...Typography.labelLg, color: Colors.onSurface },
  discloseSub: { ...Typography.bodySm, color: Colors.onSurface },
  modelNote: { backgroundColor: Colors.iconBgBlue, borderRadius: Radius.lg, padding: Spacing.md },
  modelText: { ...Typography.bodySm, color: Colors.onSurface },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.md },
  planOpt: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1.5, borderColor: Colors.transparent },
  planActive: { borderColor: Colors.primary },
  planLabel: { ...Typography.labelLg, color: Colors.onSurface },
  planHint: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  radio: { width: 20, height: 20, borderRadius: Radius.full, borderWidth: 2, borderColor: Colors.outlineVariant },
  previewRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.md, paddingHorizontal: Spacing.xs },
  previewLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  previewAmount: { ...Typography.titleLg, color: Colors.primary },
  footNote: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.sm },
  insTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  insSeq: { width: 26, height: 26, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  insSeqText: { ...Typography.labelSm, color: Colors.onSurface, fontWeight: '700' },
  insAmount: { ...Typography.labelLg, color: Colors.onSurface },
  insDue: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
