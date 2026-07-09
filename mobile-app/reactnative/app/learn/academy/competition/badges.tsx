import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Icons from 'lucide-react-native';
import { Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import ProgressBar from '@/features/academy/components/ProgressBar';
import { formatPoints, formatDate } from '@/features/academy/constants';
import {
  useCompetitionBadges, useCompetitionRewards, useCompetitionProfile, useRedeemCompetitionReward,
} from '@/features/academy/fees/hooks';
import type { CompetitionBadge, CompetitionReward } from '@/features/academy/fees/types';

const TIER_META = {
  bronze: { color: Colors.onWarning, bg: Colors.iconBgGold },
  silver: { color: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
  gold:   { color: Colors.gold, bg: Colors.iconBgGold },
} as const;

/** SA-124 — Badges & rewards. Reward points are NON-monetary (never cash). */
export default function BadgesAndRewards() {
  const badges = useCompetitionBadges();
  const rewards = useCompetitionRewards();
  const profile = useCompetitionProfile();
  const redeem = useRedeemCompetitionReward();

  if (badges.isLoading || rewards.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Badges & rewards" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }

  const points = profile.data?.totalPoints ?? 0;
  const badgeList = badges.data ?? [];
  const rewardList = rewards.data ?? [];

  const onRedeem = (r: CompetitionReward) => {
    if (points < r.pointsCost) { Alert.alert('Not enough points', `You need ${formatPoints(r.pointsCost)} to redeem this.`); return; }
    Alert.alert('Redeem?', `Spend ${formatPoints(r.pointsCost)} on "${r.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Redeem', onPress: () => redeem.mutate(r.id, {
        onSuccess: () => Alert.alert('Redeemed', `"${r.name}" is on its way.`),
        onError: (e) => Alert.alert('Could not redeem', (e as Error).message),
      }) },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Badges & rewards" subtitle={formatPoints(points)} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Badges */}
        <Text style={styles.section}>Badges</Text>
        <View style={styles.badgeGrid}>
          {badgeList.map((b) => <BadgeTile key={b.id} b={b} />)}
        </View>

        {/* Rewards */}
        <Text style={styles.section}>Redeem points</Text>
        <Text style={styles.rewardNote}>Points are earned by competing — they are not cash and can't be withdrawn.</Text>
        {rewardList.map((r) => {
          const affordable = points >= r.pointsCost;
          const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[r.icon] ?? Icons.Gift;
          return (
            <View key={r.id} style={[styles.rewardCard, shadow1]}>
              <View style={styles.rewardIcon}><Icon size={18} color={Colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rewardName}>{r.name}</Text>
                <Text style={styles.rewardDesc}>{r.description}</Text>
                <Text style={styles.rewardCost}>{formatPoints(r.pointsCost)}</Text>
              </View>
              {r.redeemed ? (
                <Chip label="Redeemed" color={Colors.teal} bg={Colors.iconBgTeal} small />
              ) : (
                <Pressable style={[styles.redeemBtn, !affordable && styles.redeemDisabled]} onPress={() => onRedeem(r)} disabled={!affordable || redeem.isPending}>
                  <Text style={[styles.redeemText, !affordable && styles.redeemTextDisabled]}>Redeem</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function BadgeTile({ b }: { b: CompetitionBadge }) {
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[b.icon] ?? Icons.Award;
  const tier = TIER_META[b.tier];
  return (
    <View style={[styles.badgeTile, shadow1, !b.earned && styles.badgeLocked]}>
      <View style={[styles.badgeIcon, { backgroundColor: b.earned ? tier.bg : Colors.surfaceContainerHigh }]}>
        {b.earned ? <Icon size={22} color={tier.color} /> : <Lock size={18} color={Colors.onSurfaceVariant} />}
      </View>
      <Text style={styles.badgeName} numberOfLines={1}>{b.name}</Text>
      <Text style={styles.badgeDesc} numberOfLines={2}>{b.description}</Text>
      {b.earned ? (
        <Text style={styles.badgeEarned}>{formatDate(b.earnedAt)}</Text>
      ) : (
        <>
          <ProgressBar pct={b.progressPct} height={5} style={{ marginTop: 4 }} />
          <Text style={styles.badgeProgress}>{b.progressPct}%</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.md },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  badgeTile: { width: '48%', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: 4 },
  badgeLocked: { opacity: 0.85 },
  badgeIcon: { width: 44, height: 44, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  badgeName: { ...Typography.labelLg, color: Colors.onSurface, marginTop: 4 },
  badgeDesc: { ...Typography.caption, color: Colors.onSurfaceVariant, minHeight: 30 },
  badgeEarned: { ...Typography.caption, color: Colors.teal, fontWeight: '700' },
  badgeProgress: { ...Typography.caption, color: Colors.onSurfaceVariant },
  rewardNote: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rewardCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  rewardIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple },
  rewardName: { ...Typography.labelLg, color: Colors.onSurface },
  rewardDesc: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rewardCost: { ...Typography.labelMd, color: Colors.primary, fontWeight: '700', marginTop: 2 },
  redeemBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: Radius.full, backgroundColor: Colors.primary },
  redeemDisabled: { backgroundColor: Colors.surfaceContainerHigh },
  redeemText: { ...Typography.labelSm, color: Colors.onPrimary, fontWeight: '700' },
  redeemTextDisabled: { color: Colors.onSurfaceVariant },
});
