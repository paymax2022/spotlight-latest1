import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { DisclosureCard } from '@/features/referral/components';
import { useTierProgression } from '@/features/referral/ambassador/hooks';

// M-AMB-06 — Tier progression & perks: path to next ambassador tier.
export default function TierProgressionScreen() {
  const { data, isLoading, isError, refetch } = useTierProgression();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Tier progression" />
      {isLoading ? (
        <StateView kind="loading" message="Loading tiers…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Progress to next */}
          <View style={styles.progressCard}>
            <Text style={styles.currentTier}>{data.currentTier} ambassador</Text>
            {data.nextTier && data.activatedToNext != null ? (
              <>
                <Text style={styles.progressLabel}>{data.activatedToNext} more activated referrals to {data.nextTier}</Text>
                {(() => {
                  const next = data.tiers.find((t) => t.name === data.nextTier);
                  const target = next?.activatedRequired ?? data.activatedReferrals + data.activatedToNext;
                  const pct = Math.min(1, data.activatedReferrals / (target || 1));
                  return (
                    <View style={styles.track}><View style={[styles.fill, { width: `${Math.round(pct * 100)}%` }]} /></View>
                  );
                })()}
                <Text style={styles.progressMeta}>{data.activatedReferrals} activated so far</Text>
              </>
            ) : (
              <Text style={styles.progressLabel}>You've reached the top tier.</Text>
            )}
          </View>

          <DisclosureCard
            tone="compliant"
            title="Progression is activity-based"
            body="Tiers advance on activated referrals — friends who genuinely use Paymax — not on how many people you sign up. Higher tiers apply a reward multiplier to your activity-based earnings."
          />

          <Text style={styles.sectionTitle}>All tiers</Text>
          <View style={styles.tiers}>
            {data.tiers.map((t, i) => (
              <View key={t.key} style={[styles.tier, t.current && styles.tierCurrent, i < data.tiers.length - 1 && styles.tierBorder]}>
                <View style={styles.tierHead}>
                  <View style={[styles.tierBadge, t.reached ? styles.tierBadgeDone : styles.tierBadgePending]}>
                    {t.reached ? <Check size={14} color={Colors.white} strokeWidth={3} /> : <Lock size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />}
                  </View>
                  <View style={styles.tierTitleWrap}>
                    <Text style={styles.tierName}>{t.name}</Text>
                    <Text style={styles.tierReq}>{t.activatedRequired}+ activated · {t.rewardMultiplier}x rewards</Text>
                  </View>
                  {t.current ? <View style={styles.currentPill}><Text style={styles.currentText}>Current</Text></View> : null}
                </View>
                {t.perks.map((p) => <Text key={p} style={styles.perk}>• {p}</Text>)}
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  progressCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm },
  currentTier: { ...Typography.labelSm, color: Colors.secondary, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.6 },
  progressLabel: { ...Typography.titleMd, color: Colors.onSurface },
  track: { height: 10, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill: { height: 10, borderRadius: Radius.full, backgroundColor: Colors.primary },
  progressMeta: { ...Typography.caption, color: Colors.onSurfaceVariant },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  tiers: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  tier: { paddingVertical: Spacing.md, gap: 4 },
  tierCurrent: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, marginHorizontal: -Spacing.sm },
  tierBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  tierHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  tierBadge: { width: 26, height: 26, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  tierBadgeDone: { backgroundColor: Colors.primary },
  tierBadgePending: { backgroundColor: Colors.surfaceContainerHigh },
  tierTitleWrap: { flex: 1 },
  tierName: { ...Typography.labelLg, color: Colors.onSurface },
  tierReq: { ...Typography.caption, color: Colors.onSurfaceVariant },
  currentPill: { backgroundColor: Colors.iconBgBlue, paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.full },
  currentText: { ...Typography.caption, color: Colors.secondary, fontWeight: '700' as const },
  perk: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginLeft: 34 },
});
