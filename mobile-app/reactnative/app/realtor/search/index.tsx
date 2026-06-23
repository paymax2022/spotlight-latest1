import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { SlidersHorizontal, LayoutGrid, Rows3, ArrowUpDown } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import SearchBar from '@/components/SearchBar';
import SegmentedControl from '@/components/SegmentedControl';
import SelectField from '@/components/SelectField';
import StateView from '@/components/StateView';
import PropertyCard from '@/features/realtor/components/PropertyCard';
import { useSearchListings } from '@/features/realtor/hooks/useRealtor';
import { useSearchStore } from '@/features/realtor/store/searchStore';
import { MODE_LABEL, SORT_LABEL, SORT_OPTIONS } from '@/features/realtor/constants/realtor.constants';
import type { SortKey, TransactionMode } from '@/features/realtor/types/realtor.types';

const MODE_SEGMENTS: { value: TransactionMode | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'long_rent', label: MODE_LABEL.long_rent },
  { value: 'for_sale', label: MODE_LABEL.for_sale },
  { value: 'short_stay', label: MODE_LABEL.short_stay },
  { value: 'for_lease', label: MODE_LABEL.for_lease },
];

export default function SearchScreen() {
  const params = useLocalSearchParams<{ area?: string; q?: string }>();
  const { filter, setFilter, activeCount } = useSearchStore();
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [sortOpen, setSortOpen] = useState(false);

  // Seed filter from incoming params (e.g. tapped a popular area on home).
  useEffect(() => {
    if (params.area) setFilter({ area: String(params.area) });
    if (params.q) setFilter({ query: String(params.q) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.area, params.q]);

  const results = useSearchListings(filter);
  const count = activeCount();

  const openListing = (id: string) => router.push(`/realtor/listing/${id}`);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Search" subtitle={results.data ? `${results.data.length} listings` : undefined} />

      <SearchBar
        value={filter.query}
        onChangeText={(t) => setFilter({ query: t })}
        placeholder="Search by area, type or budget"
      />

      <View style={styles.modeRow}>
        <SegmentedControl<TransactionMode | 'all'>
          scrollable
          options={MODE_SEGMENTS}
          value={filter.mode ?? 'all'}
          onChange={(v) => setFilter({ mode: v === 'all' ? undefined : v })}
        />
      </View>

      <View style={styles.toolbar}>
        <Pressable
          style={[styles.toolBtn, count > 0 && styles.toolBtnActive]}
          onPress={() => router.push('/realtor/search/filters')}
          accessibilityRole="button"
          accessibilityLabel="Open filters"
        >
          <SlidersHorizontal size={16} color={count > 0 ? Colors.onPrimary : Colors.onSurface} strokeWidth={2} />
          <Text style={[styles.toolText, count > 0 && styles.toolTextActive]}>
            Filters{count > 0 ? ` (${count})` : ''}
          </Text>
        </Pressable>

        <Pressable style={styles.toolBtn} onPress={() => setSortOpen(true)} accessibilityRole="button" accessibilityLabel="Sort">
          <ArrowUpDown size={16} color={Colors.onSurface} strokeWidth={2} />
          <Text style={styles.toolText}>{SORT_LABEL[filter.sort ?? 'newest']}</Text>
        </Pressable>

        <View style={styles.viewToggle}>
          <Pressable onPress={() => setView('list')} style={[styles.viewBtn, view === 'list' && styles.viewBtnActive]} accessibilityLabel="List view">
            <Rows3 size={18} color={view === 'list' ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>
          <Pressable onPress={() => setView('grid')} style={[styles.viewBtn, view === 'grid' && styles.viewBtnActive]} accessibilityLabel="Grid view">
            <LayoutGrid size={18} color={view === 'grid' ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>
        </View>
      </View>

      {/* Hidden SelectField as a sort sheet trigger */}
      {sortOpen ? (
        <View style={styles.sortSheetHost}>
          <SelectField
            label="Sort by"
            value={SORT_LABEL[filter.sort ?? 'newest']}
            options={SORT_OPTIONS.map((s) => SORT_LABEL[s])}
            searchable={false}
            onChange={(label) => {
              const key = (Object.keys(SORT_LABEL) as SortKey[]).find((k) => SORT_LABEL[k] === label);
              if (key) setFilter({ sort: key });
              setSortOpen(false);
            }}
          />
        </View>
      ) : null}

      {results.isLoading ? (
        <StateView kind="loading" message="Finding listings…" />
      ) : results.isError ? (
        <StateView kind="error" title="Search failed" message="Please try again." actionLabel="Retry" onAction={() => results.refetch()} />
      ) : (results.data?.length ?? 0) === 0 ? (
        <StateView
          kind="empty"
          icon="SearchX"
          title="No listings found"
          message="Try widening your filters or searching a different area."
          actionLabel="Clear filters"
          onAction={() => useSearchStore.getState().reset()}
        />
      ) : (
        <FlatList
          key={view}
          data={results.data}
          keyExtractor={(i) => i.id}
          numColumns={view === 'grid' ? 2 : 1}
          columnWrapperStyle={view === 'grid' ? styles.gridRow : undefined}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          renderItem={({ item }) => (
            <View style={view === 'grid' ? styles.gridItem : undefined}>
              <PropertyCard listing={item} variant="feed" onPress={() => openListing(item.id)} />
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  modeRow: { marginBottom: Spacing.md },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.containerMargin,
    marginBottom: Spacing.md,
  },
  toolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  toolBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  toolText: { ...Typography.labelSm, color: Colors.onSurface, fontWeight: '600' as const },
  toolTextActive: { color: Colors.onPrimary },
  viewToggle: {
    flexDirection: 'row',
    marginLeft: 'auto',
    backgroundColor: Colors.surfaceContainerHigh,
    borderRadius: Radius.md,
    padding: 2,
  },
  viewBtn: { padding: 6, borderRadius: Radius.DEFAULT },
  viewBtnActive: { backgroundColor: Colors.surfaceContainerLowest },
  sortSheetHost: { paddingHorizontal: Spacing.containerMargin },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  gridRow: { gap: Spacing.md },
  gridItem: { flex: 1 },
});
