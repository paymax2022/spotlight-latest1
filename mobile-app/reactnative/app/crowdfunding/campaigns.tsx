import React from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { SlidersHorizontal, ArrowUpDown } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import CampaignCard from '@/features/crowdfunding/components/CampaignCard';
import { useCampaigns, useToggleSave } from '@/features/crowdfunding/hooks/useCrowdfunding';
import { SORT_OPTIONS } from '@/features/crowdfunding/constants/crowdfunding.constants';
import type { CampaignQuery, CampaignSort } from '@/features/crowdfunding/types/crowdfunding.types';

/**
 * One parametrised list screen powers every discovery collection
 * (featured / trending / urgent / verified / recommended / category / search).
 * Filter & sort modals navigate back here with an updated query string.
 */
export default function CampaignListScreen() {
  const p = useLocalSearchParams<{
    title?: string;
    collection?: string;
    category?: string;
    type?: string;
    sort?: string;
    verifiedOnly?: string;
    urgentOnly?: string;
    minProgress?: string;
    location?: string;
  }>();

  const query: CampaignQuery = {
    collection: p.collection as CampaignQuery['collection'],
    category: p.category,
    type: p.type as CampaignQuery['type'],
    sort: (p.sort as CampaignSort) ?? 'recommended',
    verifiedOnly: p.verifiedOnly === '1' || undefined,
    urgentOnly: p.urgentOnly === '1' || undefined,
    minProgress: p.minProgress ? Number(p.minProgress) : undefined,
    location: p.location,
  };

  const { data, isLoading, isError, refetch, isRefetching } = useCampaigns(query);
  const toggleSave = useToggleSave();

  const title = p.title ?? 'Campaigns';
  const sortLabel = SORT_OPTIONS.find((s) => s.value === query.sort)?.label ?? 'Recommended';
  const filterCount =
    (query.verifiedOnly ? 1 : 0) + (query.urgentOnly ? 1 : 0) + (query.minProgress ? 1 : 0) + (query.type ? 1 : 0);

  // Preserve current params when opening the sort/filter modals.
  const paramString = new URLSearchParams(
    Object.entries(p).filter(([, v]) => v != null) as [string, string][],
  ).toString();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={title} />

      {/* Sort / filter controls */}
      <View style={styles.controls}>
        <Pressable
          style={styles.control}
          onPress={() => router.push(`/crowdfunding/sort?${paramString}`)}
          accessibilityLabel={`Sort: ${sortLabel}`}
        >
          <ArrowUpDown size={16} color={Colors.onSurface} strokeWidth={2} />
          <Text style={styles.controlText} numberOfLines={1}>{sortLabel}</Text>
        </Pressable>
        <Pressable
          style={[styles.control, filterCount > 0 && styles.controlActive]}
          onPress={() => router.push(`/crowdfunding/filter?${paramString}`)}
          accessibilityLabel="Filter campaigns"
        >
          <SlidersHorizontal size={16} color={filterCount > 0 ? Colors.onPrimary : Colors.onSurface} strokeWidth={2} />
          <Text style={[styles.controlText, filterCount > 0 && styles.controlTextActive]}>
            Filter{filterCount > 0 ? ` (${filterCount})` : ''}
          </Text>
        </Pressable>
      </View>

      {isLoading ? (
        <StateView kind="loading" message="Finding campaigns…" />
      ) : isError ? (
        <StateView kind="error" title="Something went wrong" message="We couldn't load this list." actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => (
            <CampaignCard
              campaign={item}
              onPress={() => router.push(`/crowdfunding/campaign/${item.id}`)}
              onToggleSave={(next) => toggleSave.mutate({ id: item.id, saved: next })}
            />
          )}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={refetch}
          refreshing={isRefetching}
          ListHeaderComponent={
            data && data.length > 0 ? (
              <Text style={styles.count}>{data.length} {data.length === 1 ? 'campaign' : 'campaigns'}</Text>
            ) : null
          }
          ListEmptyComponent={
            <StateView
              kind="empty"
              icon="SearchX"
              title="No campaigns found"
              message="Try adjusting your filters or explore another category."
              actionLabel="Clear filters"
              onAction={() => router.replace(`/crowdfunding/campaigns?title=${encodeURIComponent(title)}${query.collection ? `&collection=${query.collection}` : ''}${query.category ? `&category=${query.category}` : ''}`)}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  controls: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.sm },
  control: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1, borderColor: Colors.outlineVariant,
    borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 9,
  },
  controlActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  controlText: { ...Typography.labelSm, color: Colors.onSurface, maxWidth: 140 },
  controlTextActive: { color: Colors.onPrimary },
  list: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 100, flexGrow: 1 },
  count: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs },
});
