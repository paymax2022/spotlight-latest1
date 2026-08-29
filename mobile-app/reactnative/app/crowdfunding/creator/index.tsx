import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Bell, Plus, Wallet, Users, TrendingUp, ChevronRight, Eye } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import CreatorCampaignRow from '@/features/crowdfunding/components/CreatorCampaignRow';
import { useCreatorStats, useMyCampaigns, useCreatorContributions } from '@/features/crowdfunding/hooks/useCreator';
import { formatNaira, formatNairaCompact, relativeTime, maskAnonymous } from '@/features/crowdfunding/utils/crowdfundingFormatters';

export default function CreatorDashboard() {
  const stats = useCreatorStats();
  const campaigns = useMyCampaigns();
  const contributions = useCreatorContributions();

  const active = (campaigns.data ?? []).filter((c) => c.status === 'ACTIVE');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/crowdfunding')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back">
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.eyebrow}>Creator</Text>
          <Text style={styles.headerTitle}>Dashboard</Text>
        </View>
        <Pressable onPress={() => router.push('/crowdfunding/creator/notifications')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Notifications">
          <Bell size={20} color={Colors.onSurface} strokeWidth={2} />
          <View style={styles.bellDot} />
        </Pressable>
      </View>

      {stats.isLoading ? (
        <StateView kind="loading" message="Loading your dashboard…" />
      ) : stats.isError || !stats.data ? (
        <StateView kind="error" title="Couldn't load dashboard" actionLabel="Retry" onAction={() => stats.refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {/* Balance card */}
          <View style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>Total raised</Text>
            <Text style={styles.balanceValue}>{formatNaira(stats.data.totalRaisedKobo)}</Text>
            <View style={styles.balanceRow}>
              <View style={styles.balanceCol}>
                <Text style={styles.balanceColLabel}>Available</Text>
                <Text style={styles.balanceColValue}>{formatNairaCompact(stats.data.availableBalanceKobo)}</Text>
              </View>
              <View style={styles.balanceDivider} />
              <View style={styles.balanceCol}>
                <Text style={styles.balanceColLabel}>Pending</Text>
                <Text style={styles.balanceColValue}>{formatNairaCompact(stats.data.pendingBalanceKobo)}</Text>
              </View>
              <View style={styles.balanceDivider} />
              <View style={styles.balanceCol}>
                <Text style={styles.balanceColLabel}>Escrow</Text>
                <Text style={styles.balanceColValue}>{formatNairaCompact(stats.data.escrowBalanceKobo)}</Text>
              </View>
            </View>
            <Pressable style={styles.withdrawBtn} onPress={() => router.push('/crowdfunding/creator/withdrawals')} accessibilityRole="button">
              <Wallet size={16} color={Colors.onPrimary} strokeWidth={2} />
              <Text style={styles.withdrawText}>Withdraw funds</Text>
            </Pressable>
          </View>

          {/* Quick stats */}
          <View style={styles.statsRow}>
            <StatCard icon={<Users size={16} color={Colors.secondary} strokeWidth={2} />} value={stats.data.contributorCount.toLocaleString('en-NG')} label="Backers" />
            <StatCard icon={<TrendingUp size={16} color={Colors.teal} strokeWidth={2} />} value={`${stats.data.activeCampaigns}`} label="Active" />
            <StatCard icon={<Eye size={16} color={Colors.primary} strokeWidth={2} />} value={formatNairaCompact(stats.data.viewsThisWeek * 100).replace('₦', '')} label="Views/wk" />
          </View>

          {/* My campaigns */}
          <SectionHeader title="Active campaigns" actionLabel="Manage all" onAction={() => router.push('/crowdfunding/creator/campaigns')} style={styles.sectionGap} />
          <View style={styles.list}>
            {active.length === 0 ? (
              <StateView kind="empty" compact icon="Megaphone" title="No active campaigns" message="Launch a campaign to start raising." />
            ) : (
              active.map((c) => (
                <CreatorCampaignRow key={c.id} campaign={c} onPress={() => router.push(`/crowdfunding/creator/campaign/${c.id}`)} />
              ))
            )}
          </View>

          {/* Recent contributions */}
          <SectionHeader title="Recent contributions" style={styles.sectionGap} />
          <View style={[styles.recentCard, shadow1]}>
            {contributions.isLoading ? (
              <StateView kind="loading" compact />
            ) : (contributions.data ?? []).length === 0 ? (
              <StateView kind="empty" compact icon="HeartHandshake" title="No contributions yet" />
            ) : (
              (contributions.data ?? []).map((rc, i, arr) => (
                <View key={rc.id} style={[styles.recentRow, i < arr.length - 1 && styles.recentRowBorder]}>
                  <View style={styles.recentBody}>
                    <Text style={styles.recentName}>{maskAnonymous(rc.contributorName, rc.anonymous)}</Text>
                    <Text style={styles.recentCampaign} numberOfLines={1}>{rc.campaignTitle}</Text>
                  </View>
                  <View style={styles.recentRight}>
                    <Text style={styles.recentAmount}>{formatNaira(rc.amountKobo)}</Text>
                    <Text style={styles.recentTime}>{relativeTime(rc.createdAt)}</Text>
                  </View>
                </View>
              ))
            )}
          </View>

          {/* Support link */}
          {/* Quick links */}
          <View style={styles.quickLinks}>
            <QuickLink label="Wallet" onPress={() => router.push('/crowdfunding/wallet')} />
            <QuickLink label="Rewards" onPress={() => router.push('/crowdfunding/rewards')} />
            <QuickLink label="Settings" onPress={() => router.push('/crowdfunding/settings')} />
          </View>

          <Pressable style={styles.supportRow} onPress={() => router.push('/crowdfunding/support')} accessibilityRole="button">
            <Text style={styles.supportText}>Need help? Visit creator support</Text>
            <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
          </Pressable>
        </ScrollView>
      )}

      <SafeAreaView edges={['bottom']} style={styles.fabWrap}>
        <PrimaryButton label="Start a new campaign" onPress={() => router.push('/crowdfunding/create')} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

function QuickLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.quickLink} onPress={onPress} accessibilityRole="button">
      <Text style={styles.quickLinkText}>{label}</Text>
    </Pressable>
  );
}

function StatCard({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statIcon}>{icon}</View>
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  bellDot: { position: 'absolute', top: 9, right: 10, width: 8, height: 8, borderRadius: Radius.full, backgroundColor: Colors.error, borderWidth: 1.5, borderColor: Colors.surfaceContainerLow },
  headerTitleWrap: { flex: 1 },
  eyebrow: { ...Typography.caption, color: Colors.primary, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.6 },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120 },
  balanceCard: { backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg, marginTop: Spacing.sm },
  balanceLabel: { ...Typography.labelMd, color: Colors.inversePrimary },
  balanceValue: { ...Typography.headlineLg, color: Colors.onPrimary, marginTop: 2 },
  balanceRow: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.md, marginBottom: Spacing.md },
  balanceCol: { flex: 1 },
  balanceColLabel: { ...Typography.caption, color: Colors.inversePrimary },
  balanceColValue: { ...Typography.labelLg, color: Colors.onPrimary, marginTop: 2 },
  balanceDivider: { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.2)' },
  withdrawBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.secondaryContainer, borderRadius: Radius.lg, height: 48 },
  withdrawText: { ...Typography.labelLg, color: Colors.onPrimary },
  statsRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  statCard: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: 4 },
  statIcon: { width: 32, height: 32, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  statValue: { ...Typography.titleMd, color: Colors.onSurface },
  statLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  sectionGap: { marginTop: Spacing.lg, paddingHorizontal: 0 },
  list: { gap: Spacing.sm },
  recentCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  recentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.md, gap: Spacing.md },
  recentRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  recentBody: { flex: 1 },
  recentName: { ...Typography.labelMd, color: Colors.onSurface },
  recentCampaign: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  recentRight: { alignItems: 'flex-end' },
  recentAmount: { ...Typography.labelLg, color: Colors.teal },
  recentTime: { ...Typography.caption, color: Colors.outline },
  quickLinks: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg },
  quickLink: { flex: 1, alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingVertical: Spacing.md },
  quickLinkText: { ...Typography.labelMd, color: Colors.onSurface },
  supportRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.md, paddingVertical: Spacing.md },
  supportText: { ...Typography.labelMd, color: Colors.secondary },
  fabWrap: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, backgroundColor: 'rgba(248,249,255,0.96)', borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
