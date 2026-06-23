import React, { useState } from 'react';
import { FlatList, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Truck, Package, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedTabs from '@/features/crowdfunding/components/SegmentedTabs';
import { useRewardBackers } from '@/features/crowdfunding/hooks/useExtras';
import { formatNaira, relativeTime } from '@/features/crowdfunding/utils/crowdfundingFormatters';
import type { RewardFulfilmentStatus } from '@/features/crowdfunding/types/crowdfunding.types';

export const STATUS_META: Record<RewardFulfilmentStatus, { label: string; fg: string; bg: string }> = {
  PENDING_PRODUCTION: { label: 'In production', fg: '#B65A00', bg: Colors.iconBgOrange },
  READY: { label: 'Ready', fg: Colors.secondary, bg: Colors.iconBgBlue },
  SHIPPED: { label: 'Shipped', fg: Colors.secondary, bg: Colors.iconBgBlue },
  DELIVERED: { label: 'Delivered', fg: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  DELAYED: { label: 'Delayed', fg: Colors.error, bg: Colors.iconBgRed },
  CANCELLED: { label: 'Cancelled', fg: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
};

const TABS = [
  { value: 'all', label: 'All' },
  { value: 'PENDING_PRODUCTION', label: 'To make' },
  { value: 'SHIPPED', label: 'Shipped' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'DELAYED', label: 'Delayed' },
];

export default function RewardDashboard() {
  const [tab, setTab] = useState('all');
  const { data, isLoading, isError, refetch, isRefetching } = useRewardBackers(tab === 'all' ? undefined : tab);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Reward fulfilment" />
      <View style={styles.tabs}><SegmentedTabs options={TABS} value={tab} onChange={setTab} scrollable /></View>
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load backers" actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(b) => b.id}
          contentContainerStyle={styles.list}
          onRefresh={refetch}
          refreshing={isRefetching}
          renderItem={({ item }) => {
            const meta = STATUS_META[item.status];
            return (
              <Pressable style={styles.row} onPress={() => router.push(`/crowdfunding/rewards/${item.id}`)} accessibilityRole="button">
                <View style={styles.iconBox}>
                  {item.requiresShipping ? <Truck size={18} color={Colors.primary} strokeWidth={2} /> : <Package size={18} color={Colors.primary} strokeWidth={2} />}
                </View>
                <View style={styles.body}>
                  <Text style={styles.name}>{item.backerName}</Text>
                  <Text style={styles.tier} numberOfLines={1}>{item.rewardTierTitle}{item.shippingCity ? ` · ${item.shippingCity}` : ''}</Text>
                  <View style={[styles.chip, { backgroundColor: meta.bg }]}><Text style={[styles.chipText, { color: meta.fg }]}>{meta.label}</Text></View>
                </View>
                <View style={styles.right}>
                  <Text style={styles.amount}>{formatNaira(item.amountKobo)}</Text>
                  <Text style={styles.time}>{relativeTime(item.claimedAt)}</Text>
                </View>
                <ChevronRight size={16} color={Colors.outline} strokeWidth={2} />
              </Pressable>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListEmptyComponent={<StateView kind="empty" icon="Gift" title="No backers in this filter" message="Reward claims will appear here." />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  tabs: { paddingBottom: Spacing.sm },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 3 },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  tier: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  chip: { alignSelf: 'flex-start', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2, marginTop: 2 },
  chipText: { ...Typography.caption, fontWeight: '600' as const },
  right: { alignItems: 'flex-end' },
  amount: { ...Typography.labelMd, color: Colors.onSurface },
  time: { ...Typography.caption, color: Colors.outline },
  sep: { height: 1, backgroundColor: Colors.surfaceContainerHigh },
});
