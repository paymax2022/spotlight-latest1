import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Icons from 'lucide-react-native';
import { Sparkles, Check, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { DisclosureCard } from '@/features/referral/components';
import { useRanksBadges } from '@/features/referral/gamification/hooks';

// M-GAM-04 — Ranks / tiers & badges. Status & perks per tier (points NON-CASH).
export default function RanksBadgesScreen() {
  const { data, isLoading, isError, refetch } = useRanksBadges();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Ranks & badges" />
      {isLoading ? (
        <StateView kind="loading" message="Loading ranks…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Points balance (NON-CASH) */}
          <View style={styles.balanceCard}>
            <View style={styles.balanceIcon}><Sparkles size={20} color={Colors.secondary} strokeWidth={2} /></View>
            <Text style={styles.balanceValue}>{data.pointsBalance.toLocaleString('en-NG')} points</Text>
            <Text style={styles.balanceSub}>Non-cash status points · not money</Text>
            {data.nextTier && data.pointsToNext != null ? (
              <Text style={styles.balanceNext}>{data.pointsToNext.toLocaleString('en-NG')} points to {data.nextTier}</Text>
            ) : null}
          </View>

          <Text style={styles.sectionTitle}>Tiers</Text>
          <View style={styles.tiers}>
            {data.tiers.map((t, i) => (
              <View key={t.key} style={[styles.tier, t.current && styles.tierCurrent, i < data.tiers.length - 1 && styles.tierBorder]}>
                <View style={styles.tierHead}>
                  <View style={[styles.tierBadge, t.reached ? styles.tierBadgeDone : styles.tierBadgePending]}>
                    {t.reached ? <Check size={14} color={Colors.white} strokeWidth={3} /> : <Lock size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />}
                  </View>
                  <Text style={styles.tierName}>{t.name}</Text>
                  {t.current ? <View style={styles.currentPill}><Text style={styles.currentText}>Current</Text></View> : null}
                  <Text style={styles.tierThreshold}>{t.threshold.toLocaleString('en-NG')} pts</Text>
                </View>
                {t.perks.map((p) => (
                  <Text key={p} style={styles.perk}>• {p}</Text>
                ))}
              </View>
            ))}
          </View>

          <Text style={styles.sectionTitle}>Badges</Text>
          <View style={styles.badgeGrid}>
            {data.badges.map((b) => {
              const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[b.icon] ?? Icons.Award;
              return (
                <View key={b.id} style={[styles.badge, !b.earned && styles.badgeLocked]}>
                  <View style={[styles.badgeIcon, b.earned ? styles.badgeIconEarned : styles.badgeIconLocked]}>
                    <Icon size={22} color={b.earned ? Colors.onWarning : Colors.onSurfaceVariant} strokeWidth={2} />
                  </View>
                  <Text style={styles.badgeName} numberOfLines={1}>{b.name}</Text>
                  <Text style={styles.badgeDesc} numberOfLines={2}>{b.description}</Text>
                </View>
              );
            })}
          </View>

          <DisclosureCard
            tone="info"
            title="Points are status, not money"
            body="Ranks and badges are a recognition system. Points never convert to cash; real cash rewards always come from your friends' verified activity."
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  balanceCard: { alignItems: 'center', gap: 2, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingVertical: Spacing.lg },
  balanceIcon: { width: 48, height: 48, borderRadius: Radius.full, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  balanceValue: { ...Typography.headlineMd, color: Colors.onSurface, fontWeight: '800' as const },
  balanceSub: { ...Typography.caption, color: Colors.onSurfaceVariant },
  balanceNext: { ...Typography.labelSm, color: Colors.secondary, marginTop: 6 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  tiers: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  tier: { paddingVertical: Spacing.md, gap: 4 },
  tierCurrent: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, marginHorizontal: -Spacing.sm },
  tierBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  tierHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  tierBadge: { width: 26, height: 26, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  tierBadgeDone: { backgroundColor: Colors.primary },
  tierBadgePending: { backgroundColor: Colors.surfaceContainerHigh },
  tierName: { ...Typography.labelLg, color: Colors.onSurface },
  currentPill: { backgroundColor: Colors.iconBgBlue, paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.full },
  currentText: { ...Typography.caption, color: Colors.secondary, fontWeight: '700' as const },
  tierThreshold: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginLeft: 'auto' },
  perk: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginLeft: 34 },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  badge: { width: '48%', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: 4 },
  badgeLocked: { opacity: 0.7 },
  badgeIcon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  badgeIconEarned: { backgroundColor: Colors.iconBgGold },
  badgeIconLocked: { backgroundColor: Colors.surfaceContainer },
  badgeName: { ...Typography.labelLg, color: Colors.onSurface, marginTop: 4 },
  badgeDesc: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
