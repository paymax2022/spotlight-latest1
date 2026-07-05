import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CircleCheck } from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useClaim } from '@/features/insurance/claims';
import { UnderwriterBadge, PremiumRow } from '@/features/insurance/components';
import { InsuranceColors, formatNaira } from '@/features/insurance/constants/insurance.constants';

/** Settled confirmation (PRD §15.1) — payout credited to wallet. */
export default function ClaimSettled() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const claim = useClaim(id ?? '');

  if (claim.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Claim settled" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (claim.isError || !claim.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Claim settled" />
        <StateView kind="error" title="Couldn't load claim" actionLabel="Back to claims" onAction={() => router.replace('/insurance/claims')} />
      </SafeAreaView>
    );
  }

  const c = claim.data;
  const payout = c.approvedAmountKobo ?? c.claimedAmountKobo;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Claim settled" showBack={false} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><CircleCheck size={40} color={InsuranceColors.ok} strokeWidth={2} /></View>
          <Text style={styles.heroAmount}>{formatNaira(payout)}</Text>
          <Text style={styles.heroTitle}>Paid to your wallet</Text>
          <Text style={styles.heroSub}>Your claim for {c.policyName} has been settled.</Text>
        </View>

        <UnderwriterBadge disclosure={c.disclosure} />

        <View style={styles.card}>
          <PremiumRow label="Claim" value={c.perilLabel} />
          <PremiumRow label="Amount claimed" amountKobo={c.claimedAmountKobo} />
          <PremiumRow label="Amount paid" amountKobo={payout} emphasis />
        </View>

        {c.payoutLedgerRef ? <Text style={styles.ref}>Payout reference: {c.payoutLedgerRef}</Text> : null}
        {c.payoutAt ? <Text style={styles.ref}>Settled: {new Date(c.payoutAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}</Text> : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Back to claims" onPress={() => router.replace('/insurance/claims')} />
        <Text style={styles.link} onPress={() => router.replace('/insurance/policies')}>View my policies</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 24, gap: Spacing.md },
  hero: { alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.lg },
  heroIcon: { width: 72, height: 72, borderRadius: Radius.xl, backgroundColor: InsuranceColors.okBg, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  heroAmount: { ...Typography.displayLg, color: InsuranceColors.ok },
  heroTitle: { ...Typography.titleLg, color: Colors.onSurface },
  heroSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  ref: { ...Typography.labelSm, color: InsuranceColors.muted },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background, gap: Spacing.sm },
  link: { ...Typography.labelLg, color: InsuranceColors.brand, textAlign: 'center' },
});
