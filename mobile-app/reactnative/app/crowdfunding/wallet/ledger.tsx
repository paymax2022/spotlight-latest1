import React, { useState } from 'react';
import { FlatList, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedTabs from '@/features/crowdfunding/components/SegmentedTabs';
import { useLedger } from '@/features/crowdfunding/hooks/useExtras';
import { useDefaultCampaignId } from '@/features/crowdfunding/hooks/useCreator';
import { formatNaira, relativeTime } from '@/features/crowdfunding/utils/crowdfundingFormatters';

const TABS = [
  { value: 'all', label: 'All' },
  { value: 'CONTRIBUTION', label: 'In' },
  { value: 'WITHDRAWAL', label: 'Out' },
  { value: 'PLATFORM_FEE', label: 'Fees' },
  { value: 'REFUND', label: 'Refunds' },
];

export default function LedgerScreen() {
  const [tab, setTab] = useState('all');
  // Opened either from the wallet screen (which now always passes its own
  // resolved campaign) or bare — fall back the same way the wallet does.
  const { campaign: routeCampaign } = useLocalSearchParams<{ campaign?: string }>();
  const defaultCampaign = useDefaultCampaignId();
  const campaignId = routeCampaign ?? defaultCampaign.id;
  const { data, isLoading, isError, refetch, isRefetching } = useLedger(campaignId, tab === 'all' ? undefined : tab);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Ledger" subtitle="Every fund movement, immutable" />
      <View style={styles.tabs}><SegmentedTabs options={TABS} value={tab} onChange={setTab} scrollable /></View>
      {isLoading || (!routeCampaign && defaultCampaign.isLoading) ? (
        <StateView kind="loading" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load ledger" actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.list}
          onRefresh={refetch}
          refreshing={isRefetching}
          renderItem={({ item }) => {
            const credit = item.amountKobo >= 0;
            return (
              <Pressable style={styles.row} onPress={() => router.push(`/crowdfunding/wallet/transaction/${item.id}`)} accessibilityRole="button">
                <View style={styles.body}>
                  <Text style={styles.desc} numberOfLines={1}>{item.description}</Text>
                  <Text style={styles.meta}>{item.reference} · {relativeTime(item.createdAt)}</Text>
                </View>
                <View style={styles.right}>
                  <Text style={[styles.amount, { color: credit ? Colors.teal : Colors.onSurface }]}>{credit ? '+' : ''}{formatNaira(item.amountKobo)}</Text>
                  <Text style={styles.balance}>Bal {formatNaira(item.balanceKobo)}</Text>
                </View>
                <ChevronRight size={16} color={Colors.outline} strokeWidth={2} />
              </Pressable>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListEmptyComponent={<StateView kind="empty" icon="ReceiptText" title="No transactions yet" message="Wallet movements will appear here." />}
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
  body: { flex: 1 },
  desc: { ...Typography.labelMd, color: Colors.onSurface },
  meta: { ...Typography.caption, color: Colors.onSurfaceVariant },
  right: { alignItems: 'flex-end' },
  amount: { ...Typography.labelMd },
  balance: { ...Typography.caption, color: Colors.outline },
  sep: { height: 1, backgroundColor: Colors.surfaceContainerHigh },
});
