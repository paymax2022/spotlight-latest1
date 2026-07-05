import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2, Wallet, CalendarClock, Receipt, PiggyBank } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useFeeSchedules, useWallet, usePayFees, usePots } from '@/features/academy/hooks';
import { formatNaira } from '@/features/academy/constants';

const INSTALMENTS = [2, 3, 4] as const;

/**
 * P9 — Pay school fees. Reuses the Phase-1 checkout rail pattern: pay full from
 * the wallet, or BNPL in instalments. Money in kobo; wallet debits in mock.
 */
export default function PayFees() {
  const { feeId } = useLocalSearchParams<{ feeId: string }>();
  const fees = useFeeSchedules();
  const wallet = useWallet();
  const pots = usePots();
  const pay = usePayFees();

  const fee = fees.data?.find((f) => f.id === feeId);
  const [method, setMethod] = useState<'wallet' | 'bnpl'>('wallet');
  const [instalments, setInstalments] = useState<(typeof INSTALMENTS)[number]>(3);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const matchingPot = pots.data?.find((p) => p.feeScheduleId === feeId && p.savedKobo >= (fee?.totalKobo ?? Infinity));

  if (fees.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading fees…" /></SafeAreaView>;
  if (!fee) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Pay fees" /><StateView kind="error" title="Fee schedule not found" /></SafeAreaView>;

  const submit = () => {
    setError(null);
    pay.mutate(
      { feeScheduleId: fee.id, amountKobo: fee.totalKobo, method, instalments: method === 'bnpl' ? instalments : undefined },
      {
        onSuccess: () => setDone(method === 'bnpl' ? `Set up on BNPL — ${instalments} instalments. School notified.` : 'Fees paid in full. Receipt generated.'),
        onError: (e) => setError(e instanceof Error ? e.message : 'Payment failed'),
      },
    );
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Payment complete" showBack={false} />
        <View style={styles.center}>
          <View style={styles.successIcon}><CheckCircle2 size={32} color={Colors.teal} /></View>
          <Text style={styles.successTitle}>{formatNaira(fee.totalKobo)} paid</Text>
          <Text style={styles.successSub}>{done}</Text>
          <View style={styles.receiptRow}><Receipt size={14} color={Colors.onSurfaceVariant} /><Text style={styles.receiptText}>Receipt saved to EduPay history</Text></View>
        </View>
        <View style={styles.footer}><PrimaryButton label="Back to EduPay" onPress={() => router.replace('/learn/academy/parent/edupay')} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Pay school fees" subtitle={fee.schoolName} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Breakdown */}
        <View style={[styles.card, shadow1]}>
          <Text style={styles.cardTitle}>{fee.term} · {fee.classCode}</Text>
          {fee.items.map((it) => (
            <View key={it.id} style={styles.lineRow}>
              <Text style={styles.lineLabel}>{it.label}</Text>
              <Text style={styles.lineAmount}>{formatNaira(it.amountKobo)}</Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalAmount}>{formatNaira(fee.totalKobo)}</Text>
          </View>
        </View>

        {/* Pay from a ready pot */}
        {matchingPot ? (
          <Pressable style={[styles.potCard, shadow1]} onPress={() => router.push('/learn/academy/parent/edupay/pots')}>
            <PiggyBank size={18} color={Colors.teal} />
            <Text style={styles.potText}>“{matchingPot.name}” has enough saved — pay from your pot.</Text>
          </Pressable>
        ) : null}

        {/* Method */}
        <Text style={styles.section}>Payment method</Text>
        <Pressable style={[styles.method, method === 'wallet' && styles.methodActive]} onPress={() => setMethod('wallet')}>
          <Wallet size={18} color={method === 'wallet' ? Colors.primary : Colors.onSurfaceVariant} />
          <View style={{ flex: 1 }}>
            <Text style={styles.methodTitle}>Pay in full (wallet)</Text>
            <Text style={styles.methodSub}>Balance: {formatNaira(wallet.data?.spendableKobo)}</Text>
          </View>
        </Pressable>
        {fee.bnplEligible ? (
          <Pressable style={[styles.method, method === 'bnpl' && styles.methodActive]} onPress={() => setMethod('bnpl')}>
            <CalendarClock size={18} color={method === 'bnpl' ? Colors.primary : Colors.onSurfaceVariant} />
            <View style={{ flex: 1 }}>
              <Text style={styles.methodTitle}>Pay later (BNPL)</Text>
              <Text style={styles.methodSub}>Split into instalments</Text>
            </View>
          </Pressable>
        ) : null}

        {method === 'bnpl' ? (
          <View style={styles.instalRow}>
            {INSTALMENTS.map((n) => (
              <Pressable key={n} style={[styles.instal, instalments === n && styles.instalActive]} onPress={() => setInstalments(n)}>
                <Text style={[styles.instalText, instalments === n && styles.instalTextActive]}>{n}×</Text>
                <Text style={[styles.instalSub, instalments === n && styles.instalTextActive]}>{formatNaira(Math.ceil(fee.totalKobo / n))}/mo</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton
          label={method === 'bnpl' ? `Start BNPL · ${formatNaira(fee.totalKobo)}` : `Pay ${formatNaira(fee.totalKobo)}`}
          onPress={submit}
          loading={pay.isPending}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  lineLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  lineAmount: { ...Typography.bodyMd, color: Colors.onSurface },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: Colors.outlineVariant, marginTop: Spacing.sm, paddingTop: Spacing.sm },
  totalLabel: { ...Typography.labelLg, color: Colors.onSurface },
  totalAmount: { ...Typography.titleLg, color: Colors.primary },
  potCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md },
  potText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.sm },
  method: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  methodActive: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  methodTitle: { ...Typography.labelLg, color: Colors.onSurface },
  methodSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  instalRow: { flexDirection: 'row', gap: Spacing.sm },
  instal: { flex: 1, alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, paddingVertical: Spacing.md, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  instalActive: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  instalText: { ...Typography.titleMd, color: Colors.onSurface },
  instalSub: { ...Typography.caption, color: Colors.onSurfaceVariant },
  instalTextActive: { color: Colors.primary },
  error: { ...Typography.bodySm, color: Colors.error, textAlign: 'center' },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.sm },
  successIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  successTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  successSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  receiptRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.sm },
  receiptText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
