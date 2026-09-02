// ── Screen 3 — Results ───────────────────────────────────────────────────────
// Scan + filter a candidate set fast. List/grid toggle, inline facet bar (price,
// condition, verified-only, escrow-only), "Trusted first" default sort, map
// toggle top-right, save-search bell. Skeleton grid while loading; zero-results
// suggests loosening the tightest filter rather than dead-ending.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Map as MapIcon, LayoutGrid, List as ListIcon, Bell, SlidersHorizontal, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { MarketColors, formatNaira, conditionLabel } from '@/features/marketplace';
import type { SearchParams, SearchSort } from '@/features/marketplace';
import { useSearch, useCreateSavedSearch } from '@/features/marketplace/hooks';
import ListingCard from '@/features/marketplace/components/ListingCard';
import { GridSkeleton } from '@/features/marketplace/components/Skeletons';
import { HomeMenuButton } from '@/components/HomeMenu';

const SORTS: { value: SearchSort; label: string }[] = [
  { value: 'trusted_first', label: 'Trusted first' },
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price ↑' },
  { value: 'price_desc', label: 'Price ↓' },
];

type FacetToggle = 'escrowEligibleOnly' | 'verifiedSellerOnly' | 'deliveryAvailable';

export default function MarketplaceResults() {
  const raw = useLocalSearchParams<{ q?: string; categoryId?: string; sort?: string }>();
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [sort, setSort] = useState<SearchSort>((raw.sort as SearchSort) || 'trusted_first');
  const [facets, setFacets] = useState<Record<FacetToggle, boolean>>({
    escrowEligibleOnly: false,
    verifiedSellerOnly: false,
    deliveryAvailable: false,
  });

  const params: SearchParams = useMemo(
    () => ({
      q: raw.q || undefined,
      categoryId: raw.categoryId || undefined,
      sort,
      escrowEligibleOnly: facets.escrowEligibleOnly || undefined,
      verifiedSellerOnly: facets.verifiedSellerOnly || undefined,
      deliveryAvailable: facets.deliveryAvailable || undefined,
      limit: 30,
    }),
    [raw.q, raw.categoryId, sort, facets],
  );

  const search = useSearch(params);
  const saveSearch = useCreateSavedSearch();
  const results = search.data?.results ?? [];

  const toggle = (key: FacetToggle) => setFacets((f) => ({ ...f, [key]: !f[key] }));
  const anyFacetOn = Object.values(facets).some(Boolean);

  const onSaveSearch = () => {
    saveSearch.mutate({ query: raw.q, filters: params as Record<string, unknown> });
  };

  const openMap = () => {
    const p = new URLSearchParams();
    if (raw.q) p.set('q', raw.q);
    if (raw.categoryId) p.set('categoryId', raw.categoryId);
    router.push(`/marketplace/map?${p.toString()}` as never);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topRow}>
        <Pressable onPress={() => goBack('/marketplace')} hitSlop={10} accessibilityLabel="Back"><ArrowLeft size={22} color={Colors.onSurface} /></Pressable>
        <Text style={styles.title} numberOfLines={1}>{raw.q ? `“${raw.q}”` : 'Results'}</Text>
        <View style={styles.topActions}>
          <Pressable onPress={onSaveSearch} hitSlop={8} accessibilityLabel="Save this search"><Bell size={20} color={saveSearch.isSuccess ? MarketColors.brand : Colors.onSurface} /></Pressable>
          <Pressable onPress={openMap} hitSlop={8} accessibilityLabel="Map view"><MapIcon size={20} color={Colors.onSurface} /></Pressable>
          <Pressable onPress={() => setView((v) => (v === 'grid' ? 'list' : 'grid'))} hitSlop={8} accessibilityLabel="Toggle list or grid">
            {view === 'grid' ? <ListIcon size={20} color={Colors.onSurface} /> : <LayoutGrid size={20} color={Colors.onSurface} />}
          </Pressable>
          <HomeMenuButton />
        </View>
      </View>

      {/* Facet bar (inline, no full-screen modal for common facets) */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.facetBar}>
        <View style={styles.facetSortWrap}>
          <SlidersHorizontal size={14} color={MarketColors.muted} />
        </View>
        {SORTS.map((s) => (
          <Pressable key={s.value} style={[styles.facet, sort === s.value && styles.facetActive]} onPress={() => setSort(s.value)}>
            <Text style={[styles.facetText, sort === s.value && styles.facetTextActive]}>{s.label}</Text>
          </Pressable>
        ))}
        <View style={styles.divider} />
        {([['escrowEligibleOnly', 'Escrow only'], ['verifiedSellerOnly', 'Verified'], ['deliveryAvailable', 'Delivery']] as [FacetToggle, string][]).map(([k, label]) => (
          <Pressable key={k} style={[styles.facet, facets[k] && styles.facetActive]} onPress={() => toggle(k)}>
            {facets[k] ? <Check size={12} color="#FFFFFF" /> : null}
            <Text style={[styles.facetText, facets[k] && styles.facetTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {search.isLoading && !search.data ? (
        <GridSkeleton />
      ) : search.isError ? (
        <StateView kind="error" title="Couldn't load results" message="Check your connection and try again." actionLabel="Retry" onAction={() => search.refetch()} />
      ) : results.length === 0 ? (
        <StateView
          kind="empty"
          icon="SearchX"
          title="No matches"
          message={anyFacetOn ? 'Try removing a filter to widen your search.' : 'Try a different search or category.'}
          actionLabel={anyFacetOn ? 'Clear filters' : undefined}
          onAction={anyFacetOn ? () => setFacets({ escrowEligibleOnly: false, verifiedSellerOnly: false, deliveryAvailable: false }) : undefined}
        />
      ) : view === 'grid' ? (
        <FlatList
          key="grid"
          data={results}
          keyExtractor={(l) => l.id}
          numColumns={2}
          columnWrapperStyle={styles.col}
          contentContainerStyle={styles.grid}
          renderItem={({ item }) => <ListingCard item={item} onPress={(id) => router.push(`/marketplace/listing/${id}?source=results` as never)} />}
        />
      ) : (
        <FlatList
          key="list"
          data={results}
          keyExtractor={(l) => l.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable style={styles.listRow} onPress={() => router.push(`/marketplace/listing/${item.id}?source=results` as never)}>
              <View style={styles.listThumb} />
              <View style={styles.listBody}>
                <Text style={styles.listTitle} numberOfLines={2}>{item.title}</Text>
                <Text style={styles.listPrice}>{formatNaira(item.priceKobo)}</Text>
                <Text style={styles.listMeta}>{conditionLabel(item.condition)} · {item.state}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  title: { ...Typography.titleLg, color: Colors.onSurface, flex: 1 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  facetBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.sm },
  facetSortWrap: { paddingRight: 2 },
  facet: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: Radius.full, backgroundColor: MarketColors.surfaceAlt },
  facetActive: { backgroundColor: MarketColors.brand },
  facetText: { ...Typography.labelSm, color: MarketColors.muted },
  facetTextActive: { color: '#FFFFFF', fontWeight: '700' },
  divider: { width: 1, height: 20, backgroundColor: MarketColors.border, marginHorizontal: 4 },
  grid: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: Spacing.xxl },
  col: { gap: Spacing.sm },
  list: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: Spacing.xxl },
  listRow: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: MarketColors.surface, borderRadius: Radius.lg, padding: Spacing.sm },
  listThumb: { width: 84, height: 84, borderRadius: Radius.md, backgroundColor: MarketColors.surfaceAlt },
  listBody: { flex: 1, justifyContent: 'center' },
  listTitle: { ...Typography.labelLg, color: MarketColors.text },
  listPrice: { ...Typography.titleMd, color: MarketColors.brand, marginTop: 2 },
  listMeta: { ...Typography.labelSm, color: MarketColors.muted, marginTop: 2 },
});
