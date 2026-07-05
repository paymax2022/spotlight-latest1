// ── Screen 9 — Saved Searches + instant-alert manager ────────────────────────
// Passive discovery — let the market come to the buyer. List of saved queries,
// each with instant/daily/off alert-frequency control, re-run, and delete.
import React from 'react';
import { View, Text, StyleSheet, Pressable, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, Search as SearchIcon, Trash2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import { MarketColors } from '@/features/marketplace';
import type { AlertFrequency, SavedSearch } from '@/features/marketplace';
import { useSavedSearches, useDeleteSavedSearch, useToggleSavedSearch } from '@/features/marketplace/hooks';

const FREQ_OPTIONS: { value: AlertFrequency; label: string }[] = [
  { value: 'instant', label: 'Instant' },
  { value: 'daily', label: 'Daily' },
  { value: 'off', label: 'Off' },
];

function describeFilters(ss: SavedSearch): string {
  const f = ss.filters ?? {};
  const parts: string[] = [];
  if (ss.query) parts.push(`“${ss.query}”`);
  if (f.categoryId) parts.push('category');
  if (f.state) parts.push(String(f.state));
  if (f.priceMax) parts.push('price capped');
  return parts.length ? parts.join(' · ') : 'All listings';
}

export default function SavedSearches() {
  const searches = useSavedSearches();
  const del = useDeleteSavedSearch();
  const toggle = useToggleSavedSearch();
  const items = searches.data ?? [];

  const rerun = (ss: SavedSearch) => {
    const p = new URLSearchParams();
    if (ss.query) p.set('q', ss.query);
    if (ss.filters?.categoryId) p.set('categoryId', String(ss.filters.categoryId));
    router.push(`/marketplace/results?${p.toString()}` as never);
  };

  const freqOf = (ss: SavedSearch): AlertFrequency => ss.alertFrequency ?? (ss.alertEnabled ? 'instant' : 'off');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topRow}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back"><ArrowLeft size={22} color={Colors.onSurface} /></Pressable>
        <Text style={styles.title}>Saved searches</Text>
      </View>

      {searches.isLoading && !searches.data ? (
        <StateView kind="loading" message="Loading your alerts…" />
      ) : items.length === 0 ? (
        <StateView
          kind="empty"
          icon="BellRing"
          title="No saved searches"
          message="Save a search from the results screen and we'll alert you when new matches are listed."
          actionLabel="Start searching"
          onAction={() => router.push('/marketplace/search' as never)}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Pressable style={styles.queryWrap} onPress={() => rerun(item)}>
                  <SearchIcon size={16} color={MarketColors.brand} />
                  <Text style={styles.query} numberOfLines={1}>{describeFilters(item)}</Text>
                </Pressable>
                <Pressable onPress={() => del.mutate(item.id)} hitSlop={8} accessibilityLabel="Delete saved search"><Trash2 size={18} color={MarketColors.muted} /></Pressable>
              </View>
              <Text style={styles.freqLabel}>Alerts</Text>
              <SegmentedControl<AlertFrequency>
                options={FREQ_OPTIONS}
                value={freqOf(item)}
                onChange={(freq) => toggle.mutate({ id: item.id, alertEnabled: freq !== 'off', frequency: freq })}
              />
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  title: { ...Typography.titleLg, color: Colors.onSurface },
  list: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: Spacing.xxl },
  card: { backgroundColor: MarketColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: MarketColors.border, padding: Spacing.md, gap: Spacing.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  queryWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  query: { ...Typography.titleMd, color: MarketColors.text, flex: 1 },
  freqLabel: { ...Typography.labelSm, color: MarketColors.muted },
});
