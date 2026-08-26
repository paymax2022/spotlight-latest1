import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import OnboardingStep from '@/features/connect/components/OnboardingStep';
import StateView from '@/components/StateView';
import { useTierBenefits, useTierStatus } from '@/features/connect/hooks/useConnect';
import { formatKobo } from '@/features/connect/constants/format';

// ON-14 — Tier status intro. Current tier, what each unlocks.
export default function TierIntro() {
  const { data: tiers, isLoading, error, refetch } = useTierBenefits();
  const { data: status } = useTierStatus();
  const currentTier = status?.tier ?? 0;

  return (
    <OnboardingStep
      step={6}
      totalSteps={6}
      title="Your tiers & limits"
      subtitle="Each tier unlocks more — gifting, withdrawals and going live. Limits are checked on our servers."
      primaryLabel="Finish"
      onPrimary={() => router.replace('/connect/onboarding/complete')}
    >
      {isLoading ? (
        <StateView kind="loading" compact message="Loading tiers…" />
      ) : error || !tiers ? (
        <StateView kind="error" compact title="Couldn't load tiers" actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        tiers.map((t) => {
          const isCurrent = t.tier === currentTier;
          return (
            <View key={t.tier} style={[styles.card, isCurrent && styles.cardCurrent]}>
              <View style={styles.head}>
                <Text style={[styles.tierLabel, isCurrent && styles.tierLabelCurrent]}>{t.label}</Text>
                {isCurrent ? (
                  <View style={styles.currentPill}>
                    <Text style={styles.currentPillText}>You’re here</Text>
                  </View>
                ) : null}
                <Text style={styles.limit}>
                  {t.dailyLimitKobo == null
                    ? 'No fixed limit'
                    : t.dailyLimitKobo === 0
                    ? 'No money movement'
                    : `${formatKobo(t.dailyLimitKobo)}/day`}
                </Text>
              </View>
              <Text style={styles.requirement}>{t.requirement}</Text>
              {t.privileges.map((p) => (
                <View key={p} style={styles.privRow}>
                  <Check size={14} color={Colors.teal} strokeWidth={2.5} />
                  <Text style={styles.privText}>{p}</Text>
                </View>
              ))}
            </View>
          );
        })
      )}
    </OnboardingStep>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  cardCurrent: { borderColor: Colors.primary, borderWidth: 1.5 },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  tierLabel: { ...Typography.titleMd, color: Colors.onSurface },
  tierLabelCurrent: { color: Colors.primary },
  currentPill: { backgroundColor: Colors.iconBgPurple, paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.full },
  currentPillText: { ...Typography.caption, color: Colors.primary },
  limit: { ...Typography.labelMd, color: Colors.secondary, marginLeft: 'auto' },
  requirement: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs },
  privRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  privText: { ...Typography.bodyMd, color: Colors.onSurface },
});
