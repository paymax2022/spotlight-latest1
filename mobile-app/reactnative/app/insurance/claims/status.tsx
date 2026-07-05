import React, { useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Paperclip } from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useClaim, useSettleClaim } from '@/features/insurance/claims';
import { UnderwriterBadge, PremiumRow } from '@/features/insurance/components';
import ClaimStateChip from '@/features/insurance/components/claims-ClaimStateChip';
import ClaimTimeline from '@/features/insurance/components/claims-ClaimTimeline';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';

/** Claim status tracker (PRD §15.1) — state machine timeline + payout demo. */
export default function ClaimStatus() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const claim = useClaim(id ?? '');
  const settle = useSettleClaim(id ?? '');
  const idemKey = useRef(`ins-payout-${id}-${Math.random().toString(36).slice(2, 10)}`).current;

  if (claim.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Claim status" />
        <StateView kind="loading" message="Loading your claim…" />
      </SafeAreaView>
    );
  }
  if (claim.isError || !claim.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Claim status" />
        <StateView kind="error" title="Couldn't load claim" actionLabel="Retry" onAction={() => claim.refetch()} />
      </SafeAreaView>
    );
  }

  const c = claim.data;
  const settled = c.state === 'SETTLED';
  const rejected = c.state === 'REJECTED';

  const onSettle = async () => {
    await settle.mutateAsync(idemKey);
    router.replace(`/insurance/claims/settled?id=${c.id}`);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Claim status" subtitle={c.policyName} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <ClaimStateChip state={c.state} />
          <Text style={styles.peril}>{c.perilLabel}</Text>
        </View>

        <UnderwriterBadge disclosure={c.disclosure} />

        <View style={styles.card}>
          <PremiumRow label="Amount claimed" amountKobo={c.claimedAmountKobo} />
          {c.approvedAmountKobo != null ? <PremiumRow label="Amount approved" amountKobo={c.approvedAmountKobo} /> : null}
          <PremiumRow label="Reported" value={new Date(c.reportedAt).toLocaleDateString('en-NG', { dateStyle: 'medium' } as any)} />
        </View>

        {c.infoRequest ? (
          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>More information needed</Text>
            <Text style={styles.infoText}>{c.infoRequest}</Text>
          </View>
        ) : null}

        <View style={styles.evRow}>
          <Pressable style={styles.evBtn} onPress={() => router.push(`/insurance/claims/evidence?id=${c.id}`)} accessibilityRole="button">
            <Paperclip size={16} color={InsuranceColors.brand} />
            <Text style={styles.evBtnText}>Evidence ({c.evidence.length})</Text>
          </Pressable>
        </View>

        <Text style={styles.section}>Progress</Text>
        <ClaimTimeline entries={c.timeline} />

        {rejected ? (
          <View style={styles.rejectBox}>
            <Text style={styles.rejectText}>This claim was not approved. If you believe this is an error, you can raise a complaint with the underwriter.</Text>
          </View>
        ) : null}
      </ScrollView>

      {!settled && !rejected ? (
        <View style={styles.footer}>
          {/* Demo: advance the state machine to settlement (payout → wallet). */}
          <PrimaryButton
            label={c.state === 'APPROVED' || c.state === 'PAYOUT_PENDING' ? 'Receive payout to wallet' : 'Simulate settlement (demo)'}
            onPress={onSettle}
            loading={settle.isPending}
          />
        </View>
      ) : settled ? (
        <View style={styles.footer}>
          <PrimaryButton label="View settlement" onPress={() => router.replace(`/insurance/claims/settled?id=${c.id}`)} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 24, gap: Spacing.md },
  header: { gap: Spacing.xs },
  peril: { ...Typography.titleMd, color: Colors.onSurface },
  card: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  infoBox: { backgroundColor: Colors.iconBgGold, borderRadius: Radius.md, padding: Spacing.md, gap: 4 },
  infoTitle: { ...Typography.labelLg, color: Colors.onWarning },
  infoText: { ...Typography.bodySm, color: Colors.onSurface },
  evRow: { flexDirection: 'row' },
  evBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, backgroundColor: InsuranceColors.surfaceAlt, borderRadius: Radius.full, paddingVertical: 8, paddingHorizontal: Spacing.md, borderWidth: 1, borderColor: InsuranceColors.border },
  evBtnText: { ...Typography.labelLg, color: InsuranceColors.text },
  section: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  rejectBox: { backgroundColor: Colors.errorContainer, borderRadius: Radius.md, padding: Spacing.md },
  rejectText: { ...Typography.bodySm, color: Colors.onSurface, lineHeight: 20 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
