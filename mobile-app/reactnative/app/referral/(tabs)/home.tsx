import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  ChevronRight, Share2, QrCode, Users, UserCheck, Trophy, ArrowUpRight, Wallet, Clock, TrendingUp, Activity,
} from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import StateView from '@/components/StateView';
import { ReferralHeader, DisclosureCard, EarnStatePill } from '@/features/referral/components';
import { RemoteBanner } from '@/features/media/banners';
import { ReferralColors, COMPLIANT_EARN_SHORT } from '@/features/referral/constants/referral.constants';
import { formatNaira } from '@/features/referral/constants/format';
import { useDashboard, useActivity } from '@/features/referral/home/hooks';
import { tierLabel, milestoneProgress } from '@/features/referral/home/homeMap';
import type { NextMilestone } from '@/features/referral/home/types';

// M-HOME-01 — Earn dashboard. Earnings snapshot (paid/pending/vesting/clawed-back),
// invite count + funnel, leaderboard rank, quick-share, recent activity preview.
export default function ReferralHome() {
  const { data, isLoading, isError, refetch, isRefetching } = useDashboard();
  const activity = useActivity();
  // Withdrawing needs a real, loaded, positive balance - never a placeholder zero.
  const canWithdraw = !!data && !data.snapshotUnavailable && data.snapshot.eligibleKobo > 0;
  const onRefresh = () => { refetch(); activity.refetch(); };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ReferralHeader
        eyebrow="Spotlight"
        title="Earn hub"
        showBack={false}
        showRoleSwitcher
        showNotifications
        showHelp
      />

      {isLoading ? (
        <StateView kind="loading" message="Loading your Earn hub…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="Check your connection and try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefetching || activity.isRefetching} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          <DisclosureCard tone="compliant" title="How you earn" body={COMPLIANT_EARN_SHORT} />

          <RemoteBanner slug="refer-earn" priority />

          {/* Eligible balance hero */}
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>Ready to withdraw</Text>
            {data.snapshotUnavailable ? (
              <Text style={styles.heroUnavailable}>Not available right now</Text>
            ) : (
              <Text style={styles.heroValue}>{formatNaira(data.snapshot.eligibleKobo)}</Text>
            )}
            <Text style={styles.heroSub}>Lifetime earned {formatNaira(data.snapshot.lifetimeEarnedKobo)}</Text>
            {data.snapshotUnavailable ? (
              <Text style={styles.heroHint}>We couldn't load your earnings breakdown. Pull down to refresh.</Text>
            ) : data.snapshot.eligibleKobo <= 0 ? (
              <Text style={styles.heroHint}>Nothing to withdraw yet. Rewards become withdrawable once they have vested.</Text>
            ) : null}
            <View style={styles.heroActions}>
              <Pressable
                style={[styles.heroBtn, !canWithdraw && styles.heroBtnDisabled]}
                disabled={!canWithdraw}
                onPress={() => router.push('/referral/earnings/withdraw')}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canWithdraw }}
              >
                <Wallet size={16} color={Colors.onPrimary} strokeWidth={2} />
                <Text style={styles.heroBtnText}>Withdraw</Text>
              </Pressable>
              <Pressable style={styles.heroBtnGhost} onPress={() => router.push('/referral/(tabs)/earnings')} accessibilityRole="button">
                <Text style={styles.heroBtnGhostText}>View ledger</Text>
              </Pressable>
            </View>
          </View>

          {/* Earnings snapshot by state (M-HOME-03 at-a-glance) */}
          <Pressable style={styles.summaryCard} onPress={() => router.push('/referral/home/summary')} accessibilityRole="button">
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>Earnings summary</Text>
              <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
            </View>
            {data.snapshotUnavailable ? (
              <Text style={styles.unavailableText}>The breakdown could not be loaded. Pull down to refresh.</Text>
            ) : (
              <View style={styles.snapGrid}>
                <SnapTile state="pending" amount={data.snapshot.pendingKobo} />
                <SnapTile state="vesting" amount={data.snapshot.vestingKobo} />
                <SnapTile state="paid" amount={data.snapshot.paidKobo} />
                <SnapTile state="clawed_back" amount={data.snapshot.clawedBackKobo} />
              </View>
            )}
          </Pressable>

          {/* Invite funnel + rank */}
          <View style={styles.statsRow}>
            <StatCard icon={<Users size={18} color={Colors.primary} strokeWidth={2} />} value={data.invitesSent != null ? String(data.invitesSent) : '—'} label="Invited" />
            <StatCard icon={<UserCheck size={18} color={ReferralColors.ok} strokeWidth={2} />} value={data.signups != null ? `${data.activated}/${data.signups}` : String(data.activated)} label="Activated" />
            <StatCard
              icon={<Trophy size={18} color={ReferralColors.warn} strokeWidth={2} />}
              value={tierLabel(data.rankTier) ?? '—'}
              label="Tier"
            />
          </View>

          {data.nextMilestone && data.nextMilestone.remaining > 0 ? <MilestoneCard milestone={data.nextMilestone} /> : null}

          {/* Quick-share */}
          <View style={styles.quickShare}>
            <View style={{ flex: 1 }}>
              <Text style={styles.quickTitle}>Invite friends</Text>
              <Text style={styles.quickSub}>Share your code or link in seconds</Text>
            </View>
            <Pressable style={styles.quickIconBtn} onPress={() => router.push('/referral/home/my-code')} accessibilityRole="button" accessibilityLabel="My code and QR">
              <QrCode size={18} color={Colors.onSurface} strokeWidth={2} />
            </Pressable>
            <Pressable style={styles.quickPrimary} onPress={() => router.push('/referral/(tabs)/invite')} accessibilityRole="button">
              <Share2 size={16} color={Colors.onPrimary} strokeWidth={2} />
              <Text style={styles.quickPrimaryText}>Share</Text>
            </Pressable>
          </View>

          {/* Recent activity preview (M-HOME-04) */}
          <View style={styles.cardHead}>
            <Text style={styles.sectionTitle}>Recent activity</Text>
            <Pressable onPress={() => router.push('/referral/home/activity-timeline')} hitSlop={8}>
              <Text style={styles.link}>See all</Text>
            </Pressable>
          </View>
          {activity.isLoading ? (
            <StateView kind="loading" compact message="Loading activity…" />
          ) : activity.isError || !activity.data ? (
            <StateView kind="error" compact message="Couldn't load activity." actionLabel="Retry" onAction={activity.refetch} />
          ) : activity.data.length === 0 ? (
            <StateView kind="empty" compact icon="Activity" title="No activity yet" message="Your signups, activations and rewards will show here." />
          ) : (
            <View style={styles.activityCard}>
              {activity.data.slice(0, 4).map((a, i) => (
                <View key={a.id} style={[styles.activityRow, i < 3 && styles.rowBorder]}>
                  <View style={styles.activityIcon}>
                    <Activity size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.activityTitle}>{a.title}</Text>
                    <Text style={styles.activityDetail} numberOfLines={1}>{a.detail}</Text>
                  </View>
                  {a.amountKobo != null && (
                    <View style={styles.activityRight}>
                      <Text style={styles.activityAmount}>{formatNaira(a.amountKobo)}</Text>
                      {a.state && <EarnStatePill state={a.state} />}
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}

          {/* Quick links */}
          <View style={styles.linksCard}>
            <Row icon={<QrCode size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />} label="My code, link & QR" onPress={() => router.push('/referral/home/my-code')} />
            <Row icon={<TrendingUp size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />} label="Invite tracking" onPress={() => router.push('/referral/invite/tracking')} />
            <Row icon={<Clock size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />} label="Vesting tracker" onPress={() => router.push('/referral/earnings/vesting-tracker')} last />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function SnapTile({ state, amount }: { state: 'pending' | 'vesting' | 'paid' | 'clawed_back'; amount: number }) {
  return (
    <View style={styles.snapTile}>
      <Text style={styles.snapAmount}>{formatNaira(amount)}</Text>
      <EarnStatePill state={state} />
    </View>
  );
}

function MilestoneCard({ milestone }: { milestone: NextMilestone }) {
  const { done, pct } = milestoneProgress(milestone);
  const left = Math.max(milestone.remaining, 0);
  return (
    <View style={styles.milestone} accessibilityLabel={`${left} more activations to earn ${formatNaira(milestone.bonusKobo)}`}>
      <Text style={styles.milestoneTitle}>
        {left} more {left === 1 ? 'activation' : 'activations'} to earn {formatNaira(milestone.bonusKobo)}
      </Text>
      <View style={styles.milestoneBar}><View style={[styles.milestoneFill, { width: `${pct}%` }]} /></View>
      <Text style={styles.milestoneSub}>{done} of {milestone.threshold} activations</Text>
    </View>
  );
}

function StatCard({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statIcon}>{icon}</View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Row({ icon, label, onPress, last }: { icon: React.ReactNode; label: string; onPress: () => void; last?: boolean }) {
  return (
    <Pressable style={[styles.row, !last && styles.rowBorder]} onPress={onPress} accessibilityRole="button">
      <View style={styles.rowIcon}>{icon}</View>
      <Text style={styles.rowLabel}>{label}</Text>
      <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.md },

  hero: { backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg, gap: 4 },
  heroLabel: { ...Typography.labelMd, color: Colors.onPrimary, opacity: 0.85 },
  heroValue: { ...Typography.displayLg, color: Colors.onPrimary, fontWeight: '800' as const },
  heroUnavailable: { ...Typography.titleLg, color: Colors.onPrimary, fontWeight: '700' as const },
  heroSub: { ...Typography.bodySm, color: Colors.onPrimary, opacity: 0.8 },
  heroHint: { ...Typography.bodySm, color: Colors.onPrimary, opacity: 0.9 },
  heroBtnDisabled: { opacity: 0.45 },
  heroActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  heroBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.onPrimaryContainer, paddingHorizontal: Spacing.md, paddingVertical: 10, borderRadius: Radius.full },
  heroBtnText: { ...Typography.labelLg, color: Colors.onPrimary },
  heroBtnGhost: { justifyContent: 'center', paddingHorizontal: Spacing.md, paddingVertical: 10, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.onPrimary },
  heroBtnGhostText: { ...Typography.labelLg, color: Colors.onPrimary },

  summaryCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface },
  snapGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  snapTile: { width: '47%', flexGrow: 1, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.sm, gap: 6 },
  snapAmount: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' as const },

  unavailableText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },

  milestone: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm },
  milestoneTitle: { ...Typography.labelLg, color: Colors.onSurface },
  milestoneBar: { height: 6, borderRadius: 3, backgroundColor: Colors.surfaceVariant, overflow: 'hidden' },
  milestoneFill: { height: 6, borderRadius: 3, backgroundColor: Colors.primary },
  milestoneSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },

  statsRow: { flexDirection: 'row', gap: Spacing.sm },
  statCard: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingVertical: Spacing.md, alignItems: 'center', gap: 4 },
  statIcon: { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  statValue: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' as const },
  statLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },

  quickShare: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  quickTitle: { ...Typography.labelLg, color: Colors.onSurface },
  quickSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  quickIconBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  quickPrimary: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary, paddingHorizontal: Spacing.md, paddingVertical: 10, borderRadius: Radius.full },
  quickPrimaryText: { ...Typography.labelLg, color: Colors.onPrimary },

  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  link: { ...Typography.labelMd, color: Colors.primary },

  activityCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  activityIcon: { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  activityTitle: { ...Typography.labelMd, color: Colors.onSurface },
  activityDetail: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  activityRight: { alignItems: 'flex-end', gap: 4 },
  activityAmount: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' as const },

  linksCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  rowIcon: { width: 32, alignItems: 'center' },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
});
