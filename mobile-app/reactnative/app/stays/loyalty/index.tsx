import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Award, Check, Lock, PiggyBank } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useLoyaltyStatus } from '@/features/stays/reviews';
import { formatNaira, StaysColors } from '@/features/stays/constants/stays.constants';

export default function LoyaltyScreen() {
  const loyalty = useLoyaltyStatus();

  if (loyalty.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Paymax Stays" />
        <StateView kind="loading" message="Loading your loyalty status…" />
      </SafeAreaView>
    );
  }
  if (loyalty.isError || !loyalty.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Paymax Stays" />
        <StateView kind="error" title="Couldn't load loyalty" actionLabel="Retry" onAction={() => loyalty.refetch()} />
      </SafeAreaView>
    );
  }

  const l = loyalty.data;
  const progress = l.nextTier
    ? Math.min(1, l.staysInWindow / l.nextTier.staysRequired)
    : 1;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Paymax Stays" subtitle="Loyalty & perks" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Award size={28} color={Colors.gold} /></View>
          <Text style={styles.tierName}>{l.currentTierName}</Text>
          <Text style={styles.discount}>{l.discountPct}% off eligible rate plans</Text>
          <Text style={styles.window}>{l.staysCompleted} stays · {l.windowLabel}</Text>
        </View>

        {l.nextTier ? (
          <View style={styles.progressCard}>
            <View style={styles.progressHead}>
              <Text style={styles.progressTitle}>Progress to {l.nextTier.name}</Text>
              <Text style={styles.progressCount}>{l.staysInWindow}/{l.nextTier.staysRequired}</Text>
            </View>
            <View style={styles.bar}><View style={[styles.barFill, { width: `${progress * 100}%` }]} /></View>
            <Text style={styles.progressNote}>
              {l.staysToNext > 0 ? `${l.staysToNext} more stay${l.staysToNext > 1 ? 's' : ''} to unlock the next level.` : 'You qualify for the next level!'}
            </Text>
          </View>
        ) : (
          <View style={styles.maxCard}>
            <Check size={18} color={StaysColors.ok} strokeWidth={2.4} />
            <Text style={styles.maxText}>You've reached the top tier. Enjoy your full perks!</Text>
          </View>
        )}

        <View style={styles.savingsCard}>
          <PiggyBank size={20} color={Colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.savingsLabel}>Lifetime savings with Paymax Stays</Text>
            <Text style={styles.savingsVal}>{formatNaira(l.lifetimeSavingsKobo)}</Text>
          </View>
        </View>

        <Text style={styles.section}>Tiers & perks</Text>
        {l.tiers.map((tier) => {
          const unlocked = l.currentLevel >= tier.level;
          return (
            <View key={tier.level} style={[styles.tierCard, unlocked && styles.tierUnlocked]}>
              <View style={styles.tierHead}>
                <Text style={styles.tierTitle}>{tier.name}</Text>
                {unlocked ? (
                  <View style={styles.unlockedBadge}><Check size={12} color={Colors.onPrimary} strokeWidth={3} /><Text style={styles.unlockedText}>Unlocked</Text></View>
                ) : (
                  <View style={styles.lockedBadge}><Lock size={12} color={Colors.onSurfaceVariant} /><Text style={styles.lockedText}>{tier.staysRequired} stays</Text></View>
                )}
              </View>
              {tier.perks.map((perk, i) => {
                const PerkIcon = (Icons as unknown as Record<string, Icons.LucideIcon>)[perk.icon] ?? Icons.Sparkles;
                return (
                  <View key={i} style={styles.perkRow}>
                    <PerkIcon size={16} color={unlocked ? Colors.primary : Colors.onSurfaceVariant} />
                    <Text style={[styles.perkText, !unlocked && styles.perkTextLocked]}>{perk.label}</Text>
                  </View>
                );
              })}
            </View>
          );
        })}

        <PrimaryButton label="Find loyalty deals" onPress={() => router.replace('/stays/deals')} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  hero: { alignItems: 'center', gap: 4, paddingVertical: Spacing.md, backgroundColor: Colors.iconBgGold, borderRadius: Radius.lg },
  heroIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  tierName: { ...Typography.titleLg, color: Colors.onSurface, fontWeight: '800' as const },
  discount: { ...Typography.bodyMd, color: Colors.primary, fontWeight: '700' as const },
  window: { ...Typography.caption, color: Colors.onSurfaceVariant },
  progressCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm },
  progressHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '600' as const },
  progressCount: { ...Typography.labelLg, color: Colors.primary, fontWeight: '700' as const },
  bar: { height: 10, borderRadius: 5, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 5 },
  progressNote: { ...Typography.caption, color: Colors.onSurfaceVariant },
  maxCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md },
  maxText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  savingsCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  savingsLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  savingsVal: { ...Typography.titleMd, color: Colors.primary, fontWeight: '800' as const },
  section: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  tierCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm },
  tierUnlocked: { borderColor: Colors.primary },
  tierHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tierTitle: { ...Typography.titleMd, color: Colors.onSurface },
  unlockedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  unlockedText: { ...Typography.caption, color: Colors.onPrimary, fontWeight: '700' as const },
  lockedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  lockedText: { ...Typography.caption, color: Colors.onSurfaceVariant, fontWeight: '600' as const },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  perkText: { ...Typography.bodySm, color: Colors.onSurface },
  perkTextLocked: { color: Colors.onSurfaceVariant },
});
