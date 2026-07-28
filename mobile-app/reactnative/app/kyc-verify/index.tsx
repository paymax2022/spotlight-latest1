import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck, TrendingUp, Lock } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { getKycProfile } from '@/api/kyc.api';
import { TIER_LABELS, TIER_LIMITS, nextTier } from '@/features/kycverify/constants';
import { resetKycVerifyDraft, kycVerifyDraft } from '@/features/kycverify/draft';
import { nextStepRoute } from '@/features/kycverify/flow';
import type { KycTier } from '@/features/kycverify/types';

/**
 * K1 — KYC status / tier overview.
 * Shows the current tier + limits and an "Upgrade to unlock higher limits" CTA
 * that starts a step-up flow for the next tier. Also the entry point for K15
 * (step-up gate, ?target=n) and K14 (resume, when a draft is in flight).
 */
export default function KycVerifyIndexScreen() {
  const params = useLocalSearchParams<{ target?: string; stepUp?: string }>();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['kyc', 'me'],
    queryFn: getKycProfile,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Verification" />
        <StateView kind="loading" />
      </SafeAreaView>
    );
  }
  if (isError || !data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Verification" />
        <StateView kind="error" title="Couldn't load your tier" actionLabel="Retry" onAction={() => refetch()} />
      </SafeAreaView>
    );
  }

  const currentTier = (data.tier ?? 0) as KycTier;
  const requestedTarget = params.target ? (Number(params.target) as KycTier) : null;
  const target = requestedTarget ?? nextTier(currentTier);
  const limits = TIER_LIMITS[currentTier];

  // K14 resume: a draft is already in flight for this target → jump back in.
  const hasDraft =
    kycVerifyDraft.current.sessionId != null && kycVerifyDraft.current.targetTier === target;

  const startUpgrade = () => {
    if (!target) return;
    if (!hasDraft) resetKycVerifyDraft(target);
    router.push({ pathname: '/kyc-verify/requirements', params: { target: String(target) } });
  };

  const resume = () => {
    router.push(nextStepRoute(kycVerifyDraft.current));
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Verification" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Current tier card */}
        <View style={[styles.card, shadow1]}>
          <View style={styles.tierIcon}>
            <ShieldCheck size={28} color={Colors.primary} strokeWidth={2} />
          </View>
          <Text style={styles.tierLabel}>{TIER_LABELS[currentTier]}</Text>
          <Text style={styles.tierSub}>Your current verification level</Text>

          <View style={styles.limitsRow}>
            <View style={styles.limitCell}>
              <Text style={styles.limitVal}>{limits.daily}</Text>
              <Text style={styles.limitKey}>Daily limit</Text>
            </View>
            <View style={styles.limitDivider} />
            <View style={styles.limitCell}>
              <Text style={styles.limitVal}>{limits.balance}</Text>
              <Text style={styles.limitKey}>Balance</Text>
            </View>
          </View>
        </View>

        {params.stepUp === '1' && target ? (
          <View style={styles.stepUpBox}>
            <Lock size={16} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.stepUpText}>
              This action needs {TIER_LABELS[target]}. Complete the checks below to continue.
            </Text>
          </View>
        ) : null}

        {target ? (
          <View style={styles.upsell}>
            <View style={styles.upsellHead}>
              <TrendingUp size={18} color={Colors.secondary} strokeWidth={2} />
              <Text style={styles.upsellTitle}>Unlock {TIER_LABELS[target]}</Text>
            </View>
            <Text style={styles.upsellBody}>
              Reach {TIER_LABELS[target]} to raise your daily limit to {TIER_LIMITS[target].daily} and
              {' '}{TIER_LIMITS[target].balance.toLowerCase()}.
            </Text>
          </View>
        ) : (
          <View style={styles.upsell}>
            <Text style={styles.upsellTitle}>You're fully verified 🎉</Text>
            <Text style={styles.upsellBody}>You've reached the highest tier. All limits are unlocked.</Text>
          </View>
        )}
      </ScrollView>

      {target ? (
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          {hasDraft ? (
            <>
              <PrimaryButton label="Resume verification" onPress={resume} />
              <View style={{ height: Spacing.sm }} />
              <PrimaryButton label="Start over" variant="ghost" onPress={startUpgrade} />
            </>
          ) : (
            <PrimaryButton label="Upgrade to unlock higher limits" onPress={startUpgrade} />
          )}
        </SafeAreaView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.lg },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
  },
  tierIcon: {
    width: 56, height: 56, borderRadius: Radius.full,
    backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs,
  },
  tierLabel: { ...Typography.headlineMd, color: Colors.onSurface },
  tierSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  limitsRow: { flexDirection: 'row', alignItems: 'stretch', marginTop: Spacing.md, alignSelf: 'stretch' },
  limitCell: { flex: 1, alignItems: 'center', gap: 2 },
  limitDivider: { width: 1, backgroundColor: Colors.surfaceContainerHigh, marginHorizontal: Spacing.sm },
  limitVal: { ...Typography.titleMd, color: Colors.onSurface, textAlign: 'center' },
  limitKey: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  stepUpBox: {
    flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start',
    backgroundColor: Colors.iconBgBlue, borderRadius: Radius.lg, padding: Spacing.md,
  },
  stepUpText: { ...Typography.labelSm, color: Colors.onSurface, flex: 1, lineHeight: 18 },
  upsell: {
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.xs,
  },
  upsellHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  upsellTitle: { ...Typography.titleMd, color: Colors.onSurface },
  upsellBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
