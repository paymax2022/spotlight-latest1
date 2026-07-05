import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { ChevronRight, Sparkles, Coins } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { ReferralHeader, DisclosureCard } from '@/features/referral/components';
import { formatNaira } from '@/features/referral/constants/format';
import { useMissions } from '@/features/referral/gamification/hooks';
import type { MissionSummary, MissionStatus } from '@/features/referral/gamification/types';

// M-GAM-01 — Missions / quests list. "Refer + friend completes X = both earn."
// POINTS shown here are NON-CASH status rewards; any cash reward is a separate,
// activity-conditioned naira amount.

const STATUS_META: Record<MissionStatus, { label: string; color: string; bg: string }> = {
  available:   { label: 'Available',   color: Colors.secondary,         bg: Colors.iconBgBlue },
  in_progress: { label: 'In progress', color: Colors.onWarning,         bg: Colors.iconBgGold },
  completed:   { label: 'Completed',   color: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  expired:     { label: 'Expired',     color: Colors.onSurfaceVariant,  bg: Colors.surfaceContainer },
};

const QUICK_LINKS = [
  { label: 'Streaks', icon: 'Flame', route: '/referral/gamification/streaks' },
  { label: 'Ranks & badges', icon: 'Award', route: '/referral/gamification/ranks-badges' },
  { label: 'Leaderboards', icon: 'Trophy', route: '/referral/gamification/leaderboards' },
  { label: 'Contests', icon: 'Medal', route: '/referral/gamification/contests' },
] as const;

export default function ReferralMissionsTab() {
  const { data, isLoading, isError, refetch, isFetching } = useMissions();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ReferralHeader title="Missions" showBack={false} showNotifications showHelp />
      {isLoading ? (
        <StateView kind="loading" message="Loading missions…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load missions" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Quick links to other gamification surfaces */}
          <View style={styles.quickRow}>
            {QUICK_LINKS.map((q) => {
              const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[q.icon] ?? Icons.Target;
              return (
                <Pressable key={q.label} style={styles.quick} onPress={() => router.push(q.route as never)} accessibilityRole="button">
                  <View style={styles.quickIcon}><Icon size={20} color={Colors.primary} strokeWidth={2} /></View>
                  <Text style={styles.quickLabel} numberOfLines={1}>{q.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <DisclosureCard
            tone="compliant"
            title="How missions pay"
            body="You and your friend earn when they genuinely use Paymax. Points are status rewards — not money. Any cash reward is paid only on your friend's verified activity."
          />

          <View style={styles.pointsBanner}>
            <View style={styles.pointsIcon}><Sparkles size={18} color={Colors.secondary} strokeWidth={2} /></View>
            <Text style={styles.pointsText}>Points are non-cash status rewards. Cash rewards are shown separately in naira.</Text>
          </View>

          <Text style={styles.sectionTitle}>Active & available quests</Text>
          {data && data.length > 0 ? (
            data.map((m) => <MissionCard key={m.id} mission={m} />)
          ) : (
            <StateView kind="empty" icon="Target" title="No missions yet" message="New quests appear here when campaigns launch." compact />
          )}

          {isFetching ? <Text style={styles.refreshing}>Refreshing…</Text> : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function MissionCard({ mission }: { mission: MissionSummary }) {
  const meta = STATUS_META[mission.status];
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[mission.icon] ?? Icons.Target;
  const disabled = mission.status === 'expired';
  return (
    <Pressable
      style={[styles.card, disabled && styles.cardDisabled]}
      onPress={() => router.push({ pathname: '/referral/gamification/mission-detail', params: { id: mission.id } })}
      accessibilityRole="button"
    >
      <View style={styles.cardHead}>
        <View style={styles.cardIcon}><Icon size={22} color={Colors.primary} strokeWidth={2} /></View>
        <View style={styles.cardHeadText}>
          <Text style={styles.cardTitle} numberOfLines={1}>{mission.title}</Text>
          <Text style={styles.cardBlurb} numberOfLines={2}>{mission.blurb}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: meta.bg }]}>
          <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      {/* Progress */}
      <View style={styles.progressRow}>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(mission.progress * 100)}%` }]} />
        </View>
        <Text style={styles.progressText}>{mission.stepsDone}/{mission.stepsTotal}</Text>
      </View>

      {/* Rewards: points (non-cash) + optional cash */}
      <View style={styles.rewardRow}>
        <View style={styles.rewardChip}>
          <Sparkles size={14} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.rewardPoints}>{mission.reward.points} pts</Text>
          <Text style={styles.nonCash}>non-cash</Text>
        </View>
        {mission.reward.cashKobo != null ? (
          <View style={[styles.rewardChip, styles.rewardChipCash]}>
            <Coins size={14} color={Colors.tertiaryContainer} strokeWidth={2} />
            <Text style={styles.rewardCash}>{formatNaira(mission.reward.cashKobo)} cash</Text>
          </View>
        ) : null}
        <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} style={styles.chev} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 80, gap: Spacing.md },
  quickRow: { flexDirection: 'row', gap: Spacing.sm },
  quick: { flex: 1, alignItems: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingVertical: Spacing.md, paddingHorizontal: 4 },
  quickIcon: { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { ...Typography.labelSm, color: Colors.onSurface, textAlign: 'center' },
  pointsBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgBlue, borderRadius: Radius.md, padding: Spacing.sm },
  pointsIcon: { width: 30, height: 30, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center' },
  pointsText: { ...Typography.caption, color: Colors.onSurface, flex: 1 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm },
  cardDisabled: { opacity: 0.6 },
  cardHead: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  cardIcon: { width: 42, height: 42, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  cardHeadText: { flex: 1, gap: 2 },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface },
  cardBlurb: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  statusPill: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full },
  statusText: { ...Typography.labelSm, fontWeight: '700' as const },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  track: { flex: 1, height: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.primary },
  progressText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  rewardRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  rewardChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgBlue, paddingHorizontal: Spacing.sm, paddingVertical: 5, borderRadius: Radius.full },
  rewardChipCash: { backgroundColor: Colors.iconBgTeal },
  rewardPoints: { ...Typography.labelSm, color: Colors.secondary, fontWeight: '700' as const },
  nonCash: { ...Typography.caption, color: Colors.onSurfaceVariant },
  rewardCash: { ...Typography.labelSm, color: Colors.tertiaryContainer, fontWeight: '700' as const },
  chev: { marginLeft: 'auto' },
  refreshing: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
