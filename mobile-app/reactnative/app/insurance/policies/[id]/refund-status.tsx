import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { RotateCcw, Check, Clock, CircleAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useRefundStatus, usePolicy } from '@/features/insurance/hooks';
import { PremiumRow } from '@/features/insurance/components';
import { InsuranceColors, formatNaira } from '@/features/insurance/constants/insurance.constants';
import type { RefundState } from '@/features/insurance/types';

const STEPS: { state: RefundState; label: string }[] = [
  { state: 'PENDING', label: 'Refund requested' },
  { state: 'PROCESSING', label: 'Processing with provider' },
  { state: 'REFUNDED', label: 'Refunded to wallet' },
];

const RANK: Record<RefundState, number> = { NONE: -1, PENDING: 0, PROCESSING: 1, REFUNDED: 2, FAILED: 1 };

export default function RefundStatus() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const refund = useRefundStatus(id ?? '');
  const policy = usePolicy(id ?? '');

  if (refund.isLoading || policy.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Refund status" />
        <StateView kind="loading" message="Checking refund status…" />
      </SafeAreaView>
    );
  }
  if (refund.isError || !refund.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Refund status" />
        <StateView kind="error" title="Couldn't load refund status" actionLabel="Retry" onAction={() => refund.refetch()} />
      </SafeAreaView>
    );
  }

  const r = refund.data;
  const failed = r.state === 'FAILED';
  const noRefund = r.state === 'NONE';
  const currentRank = RANK[r.state];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Refund status" subtitle={policy.data?.productName} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {noRefund ? (
          <StateView kind="empty" compact title="No refund in progress" message="There's no active refund for this policy." icon="RotateCcw" />
        ) : (
          <>
            <View style={styles.hero}>
              <View style={[styles.heroIcon, failed && styles.heroIconBad]}>
                {failed ? <CircleAlert size={26} color={Colors.error} /> : <RotateCcw size={26} color={InsuranceColors.brand} />}
              </View>
              <Text style={styles.amount}>{formatNaira(r.amountKobo)}</Text>
              <Text style={styles.amountLabel}>{failed ? 'Refund failed' : r.state === 'REFUNDED' ? 'Refunded to your wallet' : 'Refund in progress'}</Text>
            </View>

            {failed ? (
              <View style={styles.failBox}>
                <Text style={styles.failText}>
                  We couldn't complete this refund automatically. Our team has been notified and will
                  resolve it. No action is needed from you.
                </Text>
              </View>
            ) : (
              <View style={styles.timeline}>
                {STEPS.map((step, i) => {
                  const done = currentRank >= RANK[step.state];
                  const active = currentRank === RANK[step.state];
                  return (
                    <View key={step.state} style={styles.stepRow}>
                      <View style={styles.stepRail}>
                        <View style={[styles.stepDot, done && styles.stepDotDone, active && styles.stepDotActive]}>
                          {done && !active ? <Check size={12} color={Colors.onPrimary} strokeWidth={3} /> : active ? <Clock size={12} color={Colors.onPrimary} /> : null}
                        </View>
                        {i < STEPS.length - 1 ? <View style={[styles.stepLine, done && styles.stepLineDone]} /> : null}
                      </View>
                      <Text style={[styles.stepLabel, done && styles.stepLabelDone]}>{step.label}</Text>
                    </View>
                  );
                })}
              </View>
            )}

            <View style={styles.card}>
              <PremiumRow label="Refund amount" amountKobo={r.amountKobo} />
              <PremiumRow label="Destination" value="Paymax wallet" />
              <PremiumRow label="Updated" value={new Date(r.updatedAt).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} />
            </View>
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Back to policy" onPress={() => router.replace(`/insurance/policies/${id}`)} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 24, gap: Spacing.md },
  hero: { alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.lg },
  heroIcon: { width: 64, height: 64, borderRadius: Radius.lg, backgroundColor: InsuranceColors.okBg, alignItems: 'center', justifyContent: 'center' },
  heroIconBad: { backgroundColor: Colors.errorContainer },
  amount: { ...Typography.headlineMd, color: Colors.onSurface },
  amountLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  failBox: { backgroundColor: Colors.errorContainer, borderRadius: Radius.lg, padding: Spacing.md },
  failText: { ...Typography.bodySm, color: Colors.onSurface, lineHeight: 20 },
  timeline: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, padding: Spacing.md },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  stepRail: { alignItems: 'center' },
  stepDot: { width: 24, height: 24, borderRadius: Radius.full, borderWidth: 2, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  stepDotDone: { backgroundColor: InsuranceColors.ok, borderColor: InsuranceColors.ok },
  stepDotActive: { backgroundColor: InsuranceColors.brand, borderColor: InsuranceColors.brand },
  stepLine: { width: 2, height: 28, backgroundColor: Colors.outlineVariant },
  stepLineDone: { backgroundColor: InsuranceColors.ok },
  stepLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, paddingTop: 2 },
  stepLabelDone: { color: Colors.onSurface, fontWeight: '600' as const },
  card: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
