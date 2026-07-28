import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, History, Gift, Crown, TrendingUp, Info, ChevronRight, Users } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import PointsBalanceCard from '@/features/loyalty/components/PointsBalanceCard';
import CatalogItemCard from '@/features/loyalty/components/CatalogItemCard';
import { useLoyaltyAccount, useTiers, useCatalog } from '@/features/loyalty/hooks';
import { LoyaltyColors, POINTS_NOT_CASH_DISCLOSURE } from '@/features/loyalty/constants/loyalty.constants';

export default function LoyaltyHome() {
  const account = useLoyaltyAccount();
  const tiers = useTiers();
  const catalog = useCatalog();

  const loading = account.isLoading || tiers.isLoading;
  const errored = account.isError || tiers.isError;
  const refetchAll = () => { account.refetch(); tiers.refetch(); catalog.refetch(); };

  const currentTier = tiers.data?.find((t) => t.id === account.data?.tierId);
  const nextTier = tiers.data?.find((t) => t.id === account.data?.nextTierId);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back">
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.eyebrow}>Paymax</Text>
          <Text style={styles.headerTitle}>Rewards</Text>
        </View>
        <Pressable onPress={() => router.push('/loyalty/how-it-works')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="How it works">
          <Info size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      </View>

      {loading ? (
        <StateView kind="loading" message="Loading your rewards…" />
      ) : errored || !account.data || !currentTier ? (
        <StateView kind="error" title="Couldn't load rewards" message="Please try again." actionLabel="Retry" onAction={refetchAll} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <PointsBalanceCard account={account.data} tier={currentTier} nextTierName={nextTier?.name} />

          {/* NL-4 disclosure */}
          <View style={styles.disclosure}>
            <Text style={styles.disclosureText}>{POINTS_NOT_CASH_DISCLOSURE}</Text>
          </View>

          <View style={styles.actionsRow}>
            <Action icon={Gift} label="Catalog" onPress={() => router.push('/loyalty/catalog')} />
            <Action icon={History} label="Earn history" onPress={() => router.push('/loyalty/earn-history')} />
            <Action icon={Crown} label="Tiers" onPress={() => router.push('/loyalty/tier-benefits')} />
            <Action icon={TrendingUp} label="Progress" onPress={() => router.push('/loyalty/progress')} />
          </View>

          <Pressable style={styles.referCta} onPress={() => router.push('/loyalty/referral')}>
            <View style={styles.referIcon}><Users size={20} color={LoyaltyColors.brandText} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.referTitle}>Refer & earn points</Text>
              <Text style={styles.referSub}>Invite friends — earn points when they join</Text>
            </View>
            <ChevronRight size={18} color={LoyaltyColors.muted} />
          </Pressable>

          <SectionHeader title="Featured rewards" actionLabel="See all" onAction={() => router.push('/loyalty/catalog')} style={styles.sectionHeader} />
          {catalog.isLoading ? (
            <StateView kind="loading" compact message="Loading rewards…" />
          ) : (catalog.data?.length ?? 0) === 0 ? (
            <StateView kind="empty" compact title="No rewards yet" message="Check back soon for rewards to redeem." icon="Gift" />
          ) : (
            <View style={styles.list}>
              {catalog.data!.slice(0, 3).map((item) => (
                <CatalogItemCard
                  key={item.id}
                  item={item}
                  balancePoints={account.data!.balancePoints}
                  locked={!!item.minTierId && tierRank(item.minTierId) > tierRank(account.data!.tierId)}
                  onPress={() => router.push({ pathname: '/loyalty/redeem', params: { itemId: item.id } })}
                />
              ))}
            </View>
          )}
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function tierRank(id: string): number {
  return { TIER1: 1, TIER2: 2, TIER3: 3 }[id] ?? 1;
}

function Action({ icon: Icon, label, onPress }: { icon: typeof Gift; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, pressed && { opacity: 0.8 }]}>
      <View style={styles.actionIcon}><Icon size={20} color={LoyaltyColors.accent} strokeWidth={2} /></View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  headerTitleWrap: { flex: 1 },
  eyebrow: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  headerTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.sm },
  disclosure: { backgroundColor: LoyaltyColors.brandBg, borderRadius: Radius.md, padding: Spacing.md },
  disclosureText: { ...Typography.bodySm, color: LoyaltyColors.brandText },
  actionsRow: { flexDirection: 'row', gap: Spacing.sm },
  action: { flex: 1, alignItems: 'center', gap: 6, backgroundColor: LoyaltyColors.surface, borderRadius: Radius.lg, paddingVertical: Spacing.md, ...shadow1 },
  actionIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: LoyaltyColors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { ...Typography.caption, color: LoyaltyColors.text },
  referCta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: LoyaltyColors.surface, borderRadius: Radius.lg, padding: Spacing.md, ...shadow1 },
  referIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: LoyaltyColors.brandBg, alignItems: 'center', justifyContent: 'center' },
  referTitle: { ...Typography.titleMd, color: Colors.onSurface },
  referSub: { ...Typography.bodySm, color: LoyaltyColors.muted, marginTop: 2 },
  sectionHeader: { paddingHorizontal: 0, marginTop: Spacing.sm },
  list: { gap: Spacing.md },
});
