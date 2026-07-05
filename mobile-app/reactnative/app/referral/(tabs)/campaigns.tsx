import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { ChevronRight, Sparkles, Store } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { ReferralHeader, DisclosureCard } from '@/features/referral/components';
import { relativeTime } from '@/features/referral/constants/format';
import { useCampaigns } from '@/features/referral/campaigns/hooks';
import type { CampaignSummary, CampaignStatus } from '@/features/referral/campaigns/types';

// M-CMP-01 — Active campaigns. What's promotable now + reward terms.
const STATUS_META: Record<CampaignStatus, { label: string; color: string; bg: string }> = {
  active:      { label: 'Active',      color: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  ending_soon: { label: 'Ending soon', color: Colors.onWarning,         bg: Colors.iconBgGold },
  upcoming:    { label: 'Upcoming',    color: Colors.secondary,         bg: Colors.iconBgBlue },
  ended:       { label: 'Ended',       color: Colors.onSurfaceVariant,  bg: Colors.surfaceContainer },
};

export default function ReferralCampaignsTab() {
  const { data, isLoading, isError, refetch } = useCampaigns();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ReferralHeader title="Campaigns" showBack={false} showNotifications showHelp />
      {isLoading ? (
        <StateView kind="loading" message="Loading campaigns…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load campaigns" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Pressable style={styles.featuredLink} onPress={() => router.push('/referral/campaigns/featured')} accessibilityRole="button">
            <View style={styles.featuredIcon}><Sparkles size={18} color={Colors.gold} strokeWidth={2} /></View>
            <Text style={styles.featuredText}>Featured & seasonal campaigns</Text>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>

          <DisclosureCard
            tone="compliant"
            title="Earnings tie to real activity"
            body="Every campaign reward is paid only when the friend you refer genuinely uses Paymax — completes KYC and qualifying actions. Rewards vest and are capped per campaign."
          />

          <Text style={styles.sectionTitle}>Active campaigns</Text>
          {data && data.length > 0 ? (
            data.map((c) => <CampaignCard key={c.id} campaign={c} />)
          ) : (
            <StateView kind="empty" icon="Megaphone" title="No active campaigns" message="New campaigns appear here when they launch." compact />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

export function CampaignCard({ campaign }: { campaign: CampaignSummary }) {
  const meta = STATUS_META[campaign.status];
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[campaign.icon] ?? Store;
  return (
    <Pressable
      style={styles.card}
      onPress={() => router.push({ pathname: '/referral/campaigns/detail', params: { id: campaign.id } })}
      accessibilityRole="button"
    >
      <View style={styles.cardHead}>
        <View style={styles.cardIcon}><Icon size={22} color={Colors.primary} strokeWidth={2} /></View>
        <View style={styles.cardHeadText}>
          <Text style={styles.cardTitle} numberOfLines={1}>{campaign.title}</Text>
          <Text style={styles.cardBlurb} numberOfLines={2}>{campaign.blurb}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: meta.bg }]}><Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text></View>
      </View>

      <View style={styles.cardFooter}>
        <View style={styles.rewardChip}><Text style={styles.rewardText}>{campaign.reward.headline}</Text></View>
        <View style={styles.footerRight}>
          {campaign.endsAt ? <Text style={styles.ends}>Ends {relativeTime(campaign.endsAt)}</Text> : null}
          <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 80, gap: Spacing.md },
  featuredLink: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  featuredIcon: { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: Colors.iconBgGold, alignItems: 'center', justifyContent: 'center' },
  featuredText: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm },
  cardHead: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  cardIcon: { width: 42, height: 42, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  cardHeadText: { flex: 1, gap: 2 },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface },
  cardBlurb: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  statusPill: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full },
  statusText: { ...Typography.labelSm, fontWeight: '700' as const },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  rewardChip: { backgroundColor: Colors.iconBgTeal, paddingHorizontal: Spacing.sm, paddingVertical: 5, borderRadius: Radius.full, flexShrink: 1 },
  rewardText: { ...Typography.labelSm, color: Colors.tertiaryContainer, fontWeight: '700' as const },
  footerRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ends: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
