import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Wallet, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { formatNaira, relativeTime } from '@/features/referral/constants/format';
import { useMerchantDashboard } from '@/features/referral/merchant/hooks';
import type { MerchantCampaignStatus } from '@/features/referral/merchant/types';

// M-MER-01 — Merchant referral dashboard: own campaign performance snapshot.
const STATUS_META: Record<MerchantCampaignStatus, { label: string; color: string; bg: string }> = {
  active:        { label: 'Active',        color: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  paused:        { label: 'Paused',        color: Colors.onWarning,         bg: Colors.iconBgGold },
  draft:         { label: 'Draft',         color: Colors.onSurfaceVariant,  bg: Colors.surfaceContainer },
  ended:         { label: 'Ended',         color: Colors.onSurfaceVariant,  bg: Colors.surfaceContainer },
  out_of_budget: { label: 'Out of budget', color: Colors.error,             bg: Colors.errorContainer },
};

export default function MerchantDashboardScreen() {
  const { data, isLoading, isError, refetch } = useMerchantDashboard();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Merchant Zone" subtitle="Fund-your-own campaigns" />
      {isLoading ? (
        <StateView kind="loading" message="Loading dashboard…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Wallet + spend */}
          <View style={styles.walletCard}>
            <View style={styles.walletIcon}><Wallet size={20} color={Colors.primary} strokeWidth={2} /></View>
            <Text style={styles.walletLabel}>Wallet available to fund campaigns</Text>
            <Text style={styles.walletValue}>{formatNaira(data.walletBalanceKobo)}</Text>
            <View style={styles.split}>
              <View style={styles.col}><Text style={styles.colLabel}>Total spent</Text><Text style={styles.colValue}>{formatNaira(data.totalSpentKobo)}</Text></View>
              <View style={styles.divider} />
              <View style={styles.col}><Text style={styles.colLabel}>Conversions</Text><Text style={styles.colValue}>{data.totalConversions}</Text></View>
              <View style={styles.divider} />
              <View style={styles.col}><Text style={styles.colLabel}>Active</Text><Text style={styles.colValue}>{data.activeCampaigns}</Text></View>
            </View>
          </View>

          <PrimaryButton label="Create & fund a campaign" onPress={() => router.push('/referral/merchant/create-fund-campaign')} />

          <Text style={styles.sectionTitle}>Your campaigns</Text>
          {data.campaigns.length === 0 ? (
            <StateView kind="empty" icon="Megaphone" title="No campaigns yet" message="Create your first funded campaign." compact />
          ) : (
            <View style={styles.list}>
              {data.campaigns.map((c, i) => {
                const meta = STATUS_META[c.status];
                const spentPct = c.budgetKobo > 0 ? Math.min(1, c.spentKobo / c.budgetKobo) : 0;
                return (
                  <Pressable
                    key={c.id}
                    style={[styles.campaign, i < data.campaigns.length - 1 && styles.campaignBorder]}
                    onPress={() => router.push({ pathname: '/referral/merchant/performance', params: { id: c.id } })}
                    accessibilityRole="button"
                  >
                    <View style={styles.campHead}>
                      <Text style={styles.campName} numberOfLines={1}>{c.name}</Text>
                      <View style={[styles.pill, { backgroundColor: meta.bg }]}><Text style={[styles.pillText, { color: meta.color }]}>{meta.label}</Text></View>
                      <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
                    </View>
                    <View style={styles.campMetaRow}>
                      <Text style={styles.campMeta}>{formatNaira(c.spentKobo)} / {formatNaira(c.budgetKobo)} · {c.conversions} conv.</Text>
                      {c.startedAt ? <Text style={styles.campMeta}>{relativeTime(c.startedAt)}</Text> : null}
                    </View>
                    <View style={styles.track}><View style={[styles.fill, { width: `${Math.round(spentPct * 100)}%` }]} /></View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  walletCard: { alignItems: 'center', gap: 2, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.lg },
  walletIcon: { width: 48, height: 48, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  walletLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  walletValue: { ...Typography.displayLg, color: Colors.onSurface, fontWeight: '800' as const },
  split: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.md, alignSelf: 'stretch' },
  col: { flex: 1, alignItems: 'center' },
  colLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  colValue: { ...Typography.labelLg, color: Colors.onSurface },
  divider: { width: 1, height: 28, backgroundColor: Colors.surfaceContainerHigh },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  list: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  campaign: { paddingVertical: Spacing.md, gap: 6 },
  campaignBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  campHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  campName: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  pill: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full },
  pillText: { ...Typography.labelSm, fontWeight: '700' as const },
  campMetaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  campMeta: { ...Typography.caption, color: Colors.onSurfaceVariant },
  track: { height: 6, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill: { height: 6, borderRadius: Radius.full, backgroundColor: Colors.primary },
});
