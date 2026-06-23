import React from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Eye, Share2, Target, Users, ChevronRight, Megaphone, Wallet, MessageSquare } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import CampaignProgress from '@/features/crowdfunding/components/CampaignProgress';
import CampaignStatusBadge from '@/features/crowdfunding/components/CampaignStatusBadge';
import { useMyCampaigns, useCampaignAnalytics } from '@/features/crowdfunding/hooks/useCreator';
import { formatNaira, formatNairaCompact } from '@/features/crowdfunding/utils/crowdfundingFormatters';

export default function CampaignPerformanceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const campaigns = useMyCampaigns();
  const analytics = useCampaignAnalytics(id);
  const campaign = (campaigns.data ?? []).find((c) => c.id === id);

  const loading = campaigns.isLoading || analytics.isLoading;

  if (loading) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Performance" /><StateView kind="loading" /></SafeAreaView>;
  if (analytics.isError || !analytics.data || !campaign) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Performance" /><StateView kind="error" title="Couldn't load analytics" actionLabel="Retry" onAction={() => { analytics.refetch(); campaigns.refetch(); }} /></SafeAreaView>;
  }

  const a = analytics.data;
  const maxDay = Math.max(...a.dailyRaised.map((d) => d.raisedKobo), 1);
  const maxVisits = Math.max(...a.trafficSources.map((t) => t.visits), 1);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Performance" subtitle={campaign.title} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <View style={styles.statusRow}><CampaignStatusBadge status={campaign.status} /></View>

        {/* Funding progress */}
        <View style={styles.card}>
          <CampaignProgress raisedKobo={campaign.raisedKobo} goalKobo={campaign.goalKobo} contributorCount={campaign.contributorCount} deadline={campaign.deadline} />
        </View>

        {/* KPI grid */}
        <View style={styles.kpiGrid}>
          <Kpi icon={<Eye size={16} color={Colors.primary} strokeWidth={2} />} value={a.views.toLocaleString('en-NG')} label="Views" />
          <Kpi icon={<Share2 size={16} color={Colors.secondary} strokeWidth={2} />} value={a.shares.toLocaleString('en-NG')} label="Shares" />
          <Kpi icon={<Target size={16} color={Colors.teal} strokeWidth={2} />} value={`${a.conversionRate}%`} label="Conversion" />
          <Kpi icon={<Users size={16} color={Colors.primary} strokeWidth={2} />} value={formatNairaCompact(a.averageContributionKobo)} label="Avg. gift" />
        </View>

        {/* Daily raised chart */}
        <Text style={styles.sectionTitle}>Raised — last 7 days</Text>
        <View style={styles.chartCard}>
          <View style={styles.chartRow}>
            {a.dailyRaised.map((d, i) => (
              <View key={i} style={styles.barCol}>
                <View style={styles.barTrack}>
                  <View style={[styles.bar, { height: `${Math.max(4, (d.raisedKobo / maxDay) * 100)}%` }]} />
                </View>
                <Text style={styles.barLabel}>{new Date(d.date).toLocaleDateString('en-NG', { weekday: 'short' }).charAt(0)}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.chartCaption}>Peak day {formatNaira(maxDay)}</Text>
        </View>

        {/* Traffic sources */}
        <Text style={styles.sectionTitle}>Traffic sources</Text>
        <View style={styles.card}>
          {a.trafficSources.map((t, i, arr) => (
            <View key={t.source} style={[styles.srcRow, i < arr.length - 1 && styles.srcRowBorder]}>
              <View style={styles.srcHead}>
                <Text style={styles.srcName}>{t.source}</Text>
                <Text style={styles.srcVisits}>{t.visits.toLocaleString('en-NG')} visits · {t.contributions} gave</Text>
              </View>
              <View style={styles.srcTrack}><View style={[styles.srcFill, { width: `${(t.visits / maxVisits) * 100}%` }]} /></View>
            </View>
          ))}
        </View>

        {/* Quick actions */}
        <Text style={styles.sectionTitle}>Manage</Text>
        <ActionRow icon={<Megaphone size={18} color={Colors.primary} strokeWidth={2} />} label="Post an update" onPress={() => router.push(`/crowdfunding/campaign/${id}/post-update`)} />
        <ActionRow icon={<MessageSquare size={18} color={Colors.secondary} strokeWidth={2} />} label="Message contributors" onPress={() => router.push(`/crowdfunding/campaign/${id}/broadcast`)} />
        <ActionRow icon={<Target size={18} color={Colors.tertiaryContainer} strokeWidth={2} />} label="Manage milestones" onPress={() => router.push(`/crowdfunding/milestones/${id}`)} />
        <ActionRow icon={<Wallet size={18} color={Colors.secondary} strokeWidth={2} />} label="Campaign wallet & withdraw" onPress={() => router.push('/crowdfunding/wallet')} />
        <ActionRow icon={<Share2 size={18} color={Colors.teal} strokeWidth={2} />} label="Share campaign" onPress={() => router.push(`/crowdfunding/campaign/${id}/share`)} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Kpi({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <View style={styles.kpi}>
      <View style={styles.kpiIcon}>{icon}</View>
      <Text style={styles.kpiValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

function ActionRow({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.actionRow, pressed && { opacity: 0.8 }]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.actionIcon}>{icon}</View>
      <Text style={styles.actionLabel}>{label}</Text>
      <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60 },
  statusRow: { marginBottom: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.md },
  kpi: { width: '47.8%', flexGrow: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: 4 },
  kpiIcon: { width: 32, height: 32, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  kpiValue: { ...Typography.titleMd, color: Colors.onSurface },
  kpiLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  chartCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 120, gap: Spacing.sm },
  barCol: { flex: 1, alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' },
  barTrack: { width: '100%', flex: 1, justifyContent: 'flex-end', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.sm, overflow: 'hidden' },
  bar: { width: '100%', backgroundColor: Colors.primary, borderRadius: Radius.sm },
  barLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  chartCaption: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.sm, textAlign: 'center' },
  srcRow: { paddingVertical: Spacing.sm, gap: 6 },
  srcRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  srcHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  srcName: { ...Typography.labelMd, color: Colors.onSurface },
  srcVisits: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  srcTrack: { height: 6, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  srcFill: { height: '100%', borderRadius: Radius.full, backgroundColor: Colors.secondary },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  actionIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
});
