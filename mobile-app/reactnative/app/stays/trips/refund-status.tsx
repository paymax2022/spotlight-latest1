import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, Wallet } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useRefundStatus, type RefundStatusStep } from '@/features/stays/trips';
import { formatNaira, StaysColors } from '@/features/stays/constants/stays.constants';

const STEPS: { key: RefundStatusStep; label: string; desc: string }[] = [
  { key: 'requested', label: 'Refund requested', desc: 'Cancellation received and validated against the policy snapshot.' },
  { key: 'approved', label: 'Refund approved', desc: 'A reversing ledger entry was posted — no manual ops needed.' },
  { key: 'credited', label: 'Credited to wallet', desc: 'Funds are available in your Paymax wallet.' },
];

const ORDER: RefundStatusStep[] = ['requested', 'approved', 'credited'];

export default function RefundStatusScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const refund = useRefundStatus(id ?? '');

  if (refund.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Refund status" />
        <StateView kind="loading" message="Loading refund status…" />
      </SafeAreaView>
    );
  }
  if (refund.isError || !refund.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Refund status" />
        <StateView kind="error" title="Couldn't load refund" actionLabel="Retry" onAction={() => refund.refetch()} />
      </SafeAreaView>
    );
  }

  const r = refund.data;
  const currentIdx = ORDER.indexOf(r.status);
  const noRefund = r.amountKobo === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Refund status" subtitle={r.reference} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.amountCard}>
          <View style={styles.walletIcon}><Wallet size={28} color={Colors.primary} /></View>
          <Text style={styles.amountLabel}>{noRefund ? 'No refund due' : 'Refund to wallet'}</Text>
          <Text style={styles.amount}>{formatNaira(r.amountKobo)}</Text>
          {!noRefund ? <Text style={styles.dest}>Destination: Paymax wallet</Text> : <Text style={styles.dest}>Non-refundable rate per policy.</Text>}
        </View>

        {!noRefund ? (
          <View style={styles.timeline}>
            {STEPS.map((s, i) => {
              const done = i <= currentIdx;
              const last = i === STEPS.length - 1;
              return (
                <View key={s.key} style={styles.tlRow}>
                  <View style={styles.tlCol}>
                    <View style={[styles.dot, done && styles.dotOn]}>{done ? <Check size={12} color={Colors.onPrimary} strokeWidth={3} /> : null}</View>
                    {!last ? <View style={[styles.barLine, done && styles.barLineOn]} /> : null}
                  </View>
                  <View style={styles.tlBody}>
                    <Text style={[styles.tlLabel, done && styles.tlLabelOn]}>{s.label}</Text>
                    <Text style={styles.tlDesc}>{s.desc}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        {r.status === 'credited' && !noRefund ? (
          <View style={styles.creditedNote}>
            <Check size={16} color={StaysColors.ok} strokeWidth={2.4} />
            <Text style={styles.creditedText}>Funds are in your wallet now. Refunds are reversing ledger entries — never a manual queue.</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="View wallet" onPress={() => router.push('/stays/profile/wallet-overview')} />
        <PrimaryButton label="Back to bookings" variant="secondary" onPress={() => router.replace('/stays/trips')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  amountCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.lg, alignItems: 'center', gap: 4 },
  walletIcon: { width: 56, height: 56, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  amountLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  amount: { ...Typography.headlineMd, color: Colors.primary, fontWeight: '800' as const },
  dest: { ...Typography.caption, color: Colors.onSurfaceVariant },
  timeline: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  tlRow: { flexDirection: 'row', gap: Spacing.md },
  tlCol: { alignItems: 'center', width: 24 },
  dot: { width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: Colors.primary },
  barLine: { width: 2, flex: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: 2 },
  barLineOn: { backgroundColor: Colors.primary },
  tlBody: { flex: 1, paddingBottom: Spacing.lg },
  tlLabel: { ...Typography.labelLg, color: Colors.onSurfaceVariant, fontWeight: '600' as const },
  tlLabelOn: { color: Colors.onSurface },
  tlDesc: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 1 },
  creditedNote: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md, alignItems: 'center' },
  creditedText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.sm },
});
