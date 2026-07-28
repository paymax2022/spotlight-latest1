import React, { useState } from 'react';
import { FlatList, View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronRight, ImageOff } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedTabs from '@/features/crowdfunding/components/SegmentedTabs';
import { useContributions } from '@/features/crowdfunding/hooks/useCrowdfunding';
import { formatNaira, relativeTime } from '@/features/crowdfunding/utils/crowdfundingFormatters';
import type { ContributionStatus } from '@/features/crowdfunding/types/crowdfunding.types';

const STATUS_META: Record<ContributionStatus, { label: string; fg: string; bg: string }> = {
  SUCCESSFUL:       { label: 'Successful',  fg: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  PROCESSING:       { label: 'Processing',  fg: Colors.secondary,         bg: Colors.iconBgBlue },
  PENDING:          { label: 'Pending',     fg: '#B65A00',                bg: Colors.iconBgOrange },
  FAILED:           { label: 'Failed',      fg: Colors.error,             bg: Colors.iconBgRed },
  REFUND_REQUESTED: { label: 'Refund req.', fg: '#B65A00',                bg: Colors.iconBgOrange },
  REFUNDED:         { label: 'Refunded',    fg: Colors.onSurfaceVariant,  bg: Colors.surfaceContainerHigh },
};

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'SUCCESSFUL', label: 'Successful' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'REFUND_REQUESTED', label: 'Refunds' },
];

export default function ContributionsScreen() {
  const [filter, setFilter] = useState('all');
  const { data, isLoading, isError, refetch, isRefetching } = useContributions(filter === 'all' ? undefined : { status: filter });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My contributions" />
      <View style={styles.filterWrap}>
        <SegmentedTabs options={FILTERS} value={filter} onChange={setFilter} scrollable />
      </View>

      {isLoading ? (
        <StateView kind="loading" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load contributions" actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          onRefresh={refetch}
          refreshing={isRefetching}
          renderItem={({ item }) => {
            const meta = STATUS_META[item.status];
            return (
              <Pressable style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]} onPress={() => router.push(`/crowdfunding/contributions/${item.id}`)} accessibilityRole="button">
                <View style={styles.thumb}>
                  {item.campaignCover ? <Image source={{ uri: item.campaignCover }} style={styles.thumbImg} /> : <ImageOff size={18} color={Colors.outline} />}
                </View>
                <View style={styles.body}>
                  <Text style={styles.title} numberOfLines={1}>{item.campaignTitle}</Text>
                  <Text style={styles.meta}>{relativeTime(item.createdAt)} · {item.paymentMethod}</Text>
                  <View style={[styles.chip, { backgroundColor: meta.bg }]}><Text style={[styles.chipText, { color: meta.fg }]}>{meta.label}</Text></View>
                </View>
                <View style={styles.right}>
                  <Text style={styles.amount}>{formatNaira(item.amountKobo)}</Text>
                  <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <StateView kind="empty" icon="HeartHandshake" title="No contributions yet" message="When you support a campaign, it appears here." actionLabel="Explore campaigns" onAction={() => router.replace('/crowdfunding')} />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  filterWrap: { paddingBottom: Spacing.sm },
  list: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: 100, flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.sm },
  thumb: { width: 52, height: 52, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbImg: { width: '100%', height: '100%' },
  body: { flex: 1, gap: 2 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  chip: { alignSelf: 'flex-start', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2, marginTop: 2 },
  chipText: { ...Typography.caption, fontWeight: '600' as const },
  right: { alignItems: 'flex-end', gap: 4 },
  amount: { ...Typography.labelLg, color: Colors.onSurface },
});
