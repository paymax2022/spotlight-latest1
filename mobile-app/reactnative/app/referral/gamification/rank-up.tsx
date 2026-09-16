import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { PartyPopper, Sparkles, Award, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useRankUp } from '@/features/referral/gamification/hooks';

// M-GAM-07 — Rank-up / reward celebration. Reward moment + share hook.
export default function RankUpScreen() {
  const { data, isLoading, isError, refetch } = useRankUp();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Rank up" />
      {isLoading ? (
        <StateView kind="loading" message="Loading…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <View style={styles.confetti}><PartyPopper size={42} color={Colors.gold} strokeWidth={2} /></View>
            <Text style={styles.congrats}>You reached</Text>
            <Text style={styles.tier}>{data.newTier}</Text>
            {data.badge ? (
              <View style={styles.badgePill}><Award size={14} color={Colors.onWarning} strokeWidth={2} /><Text style={styles.badgeText}>{data.badge} badge</Text></View>
            ) : null}
          </View>

          {/* Bonus points (NON-CASH) */}
          <View style={styles.bonusCard}>
            <View style={styles.bonusIcon}><Sparkles size={20} color={Colors.secondary} strokeWidth={2} /></View>
            <View style={styles.bonusText}>
              <Text style={styles.bonusValue}>+{data.bonusPoints} points</Text>
              <Text style={styles.bonusSub}>Non-cash status bonus for ranking up</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Perks unlocked</Text>
          <View style={styles.perks}>
            {data.unlockedPerks.map((p, i) => (
              <View key={p} style={[styles.perk, i < data.unlockedPerks.length - 1 && styles.perkBorder]}>
                <View style={styles.perkDot}><Check size={13} color={Colors.white} strokeWidth={3} /></View>
                <Text style={styles.perkText}>{p}</Text>
              </View>
            ))}
          </View>

          <View style={styles.shareCard}>
            <Text style={styles.shareLabel}>Share your moment</Text>
            <Text style={styles.shareHook}>“{data.shareHook}”</Text>
          </View>

          <View style={styles.actions}>
            <PrimaryButton label="Share" onPress={() => router.push('/referral/invite/share-by-name' as never)} />
            <PrimaryButton label="Back to missions" onPress={() => goBack('/referral')} variant="ghost" />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  hero: { alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingVertical: Spacing.xl },
  confetti: { width: 72, height: 72, borderRadius: Radius.full, backgroundColor: Colors.iconBgGold, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  congrats: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  tier: { ...Typography.displayLg, color: Colors.primary, fontWeight: '800' as const },
  badgePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgGold, paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: Radius.full, marginTop: Spacing.sm },
  badgeText: { ...Typography.labelSm, color: Colors.onWarning, fontWeight: '700' as const },
  bonusCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  bonusIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  bonusText: { flex: 1 },
  bonusValue: { ...Typography.titleMd, color: Colors.onSurface },
  bonusSub: { ...Typography.caption, color: Colors.onSurfaceVariant },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  perks: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  perk: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  perkBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  perkDot: { width: 22, height: 22, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  perkText: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  shareCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: 4 },
  shareLabel: { ...Typography.labelMd, color: Colors.onSurface },
  shareHook: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, fontStyle: 'italic' },
  actions: { gap: Spacing.sm, marginTop: Spacing.xs },
});
