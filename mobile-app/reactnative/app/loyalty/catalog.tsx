import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import SegmentedControl from '@/components/SegmentedControl';
import StateView from '@/components/StateView';
import CatalogItemCard from '@/features/loyalty/components/CatalogItemCard';
import { useCatalog, useLoyaltyAccount } from '@/features/loyalty/hooks';
import { LoyaltyColors, formatPoints } from '@/features/loyalty/constants/loyalty.constants';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'airtime', label: 'Airtime' },
  { value: 'bill', label: 'Bills' },
  { value: 'discount', label: 'Discounts' },
  { value: 'perk', label: 'Perks' },
] as const;

function tierRank(id?: string | null): number {
  return id ? ({ TIER1: 1, TIER2: 2, TIER3: 3 }[id] ?? 1) : 0;
}

export default function Catalog() {
  const catalog = useCatalog();
  const account = useLoyaltyAccount();
  const [filter, setFilter] = useState<string>('all');

  const items = useMemo(() => {
    let list = catalog.data ?? [];
    if (filter !== 'all') list = list.filter((i) => i.kind === filter);
    return list;
  }, [catalog.data, filter]);

  const loading = catalog.isLoading || account.isLoading;
  const errored = catalog.isError || account.isError;
  const myRank = tierRank(account.data?.tierId);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Rewards catalog" subtitle={account.data ? formatPoints(account.data.balancePoints) + ' available' : undefined} />
      <View style={{ marginBottom: Spacing.md }}>
        <SegmentedControl scrollable options={FILTERS as any} value={filter} onChange={setFilter} />
      </View>

      {loading ? (
        <StateView kind="loading" message="Loading rewards…" />
      ) : errored ? (
        <StateView kind="error" title="Couldn't load catalog" message="Please try again." actionLabel="Retry" onAction={() => { catalog.refetch(); account.refetch(); }} />
      ) : items.length === 0 ? (
        <StateView kind="empty" title="No rewards here" message="Try a different category." icon="Gift" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.note}><Text style={styles.noteText}>Redeem points for airtime, bill credit, discounts and perks — never cash.</Text></View>
          {items.map((item) => (
            <CatalogItemCard
              key={item.id}
              item={item}
              balancePoints={account.data?.balancePoints ?? 0}
              locked={!!item.minTierId && tierRank(item.minTierId) > myRank}
              onPress={() => router.push({ pathname: '/loyalty/redeem', params: { itemId: item.id } })}
            />
          ))}
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md },
  note: { backgroundColor: LoyaltyColors.brandBg, borderRadius: Radius.md, padding: Spacing.sm },
  noteText: { ...Typography.caption, color: LoyaltyColors.brandText, textAlign: 'center' },
});
