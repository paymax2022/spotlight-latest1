import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import SearchBar from '@/components/SearchBar';
import ModuleGrid from '@/components/ModuleGrid';
import SectionHeader from '@/components/SectionHeader';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { SERVICE_MODULES } from '@/constants/modules';
import { useUserModuleState } from '@/features/modules/visibility';
import { registryKeyFor } from '@/features/modules/serviceModuleKeys';

const CATEGORIES = [
  { key: 'all',        label: 'All' },
  { key: 'financial',  label: 'Finance' },
  { key: 'investment', label: 'Investment' },
  { key: 'utility',    label: 'Utility' },
  { key: 'health',     label: 'Health' },
  { key: 'lifestyle',  label: 'Lifestyle' },
  { key: 'contest',    label: 'Contest' },
  { key: 'property',   label: 'Property' },
  { key: 'community',  label: 'Community' },
] as const;

type Cat = typeof CATEGORIES[number]['key'];

const BANDS: { key: Exclude<Cat, 'all'>; label: string; desc: string }[] = [
  { key: 'financial',  label: 'Financial Services',      desc: 'Wallet, transfers, cards & more' },
  { key: 'investment', label: 'Investment',              desc: 'Stocks, crypto, learn & grow your wealth' },
  { key: 'utility',    label: 'Utility Payments',        desc: 'Airtime, data, electricity, cable & more' },
  { key: 'health',     label: 'Health',                  desc: 'Telemedicine, veterinary, pharmacy & lab' },
  { key: 'lifestyle',  label: 'Lifestyle & Marketplace', desc: 'Food, ride, shopping & more' },
  { key: 'contest',    label: 'Contest',                 desc: 'Enter contests, vote & apply to compete' },
  { key: 'property',   label: 'Property Management',     desc: 'Realtor, estate, visitor access & more' },
  { key: 'community',  label: 'Community & Business',    desc: 'Associations, crowdfunding, events & more' },
];

export default function ServicesScreen() {
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [activeCat, setActiveCat] = useState<Cat>('all');
  const [search, setSearch]       = useState('');

  // Seed the search field when navigated here with a query (e.g. from the home search bar).
  useEffect(() => {
    if (typeof q === 'string') setSearch(q);
  }, [q]);

  const isSearch = search.trim().length > 0;

  // Registry gate. One filter here covers every band, chip and search result, so
  // an unpublished module cannot leak through a path someone forgot to update.
  // Tiles with no registry mapping are always shown (see serviceModuleKeys), and
  // an unreachable registry shows everything rather than emptying the tab.
  // A registry 'comingSoon' module STAYS on the grid but is marked inert — that is the
  // whole point of the state, so it must not be filtered out with the hidden ones.
  // ModuleCard already drops onPress for comingSoon, so marking the flag is sufficient.
  // The registry can also CLEAR a shipped comingSoon by publishing the module 'visible',
  // which is how ops retires a placeholder without an app release.
  // Per-USER state: the environment gate intersected with this user's entitlements,
  // so a module published for the tier but not granted to this (unverified) user is
  // hidden rather than shown-and-broken.
  const { stateOf } = useUserModuleState();
  const visibleModules = React.useMemo(
    () => SERVICE_MODULES.flatMap((m) => {
      const key = registryKeyFor(m.id);
      if (key === null) return [m];        // unmapped tiles are always shown as built
      switch (stateOf(key)) {
        case 'hidden':     return [];
        case 'comingSoon': return [{ ...m, comingSoon: true }];
        default:           return [{ ...m, comingSoon: false }];
      }
    }),
    [stateOf],
  );

  const searchResults = isSearch
    ? visibleModules.filter((m) => m.label.toLowerCase().includes(search.toLowerCase()))
    : [];

  const bandsWithModules = BANDS.map((b) => ({
    ...b,
    modules: visibleModules.filter((m) => m.category === b.key),
  })).filter((b) => b.modules.length > 0);

  const singleCatModules = activeCat !== 'all'
    ? visibleModules.filter((m) => m.category === activeCat)
    : [];

  const activeBandLabel = BANDS.find((b) => b.key === activeCat)?.label;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>All Services</Text>
      </View>

      <SearchBar value={search} onChangeText={setSearch} placeholder="Search a service…" />

      {!isSearch && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chips}
          contentContainerStyle={styles.chipsContent}
        >
          {CATEGORIES.map((cat) => (
            <Pressable
              key={cat.key}
              onPress={() => setActiveCat(cat.key)}
              style={[styles.chip, activeCat === cat.key && styles.chipActive]}
            >
              <Text style={[styles.chipLabel, activeCat === cat.key && styles.chipLabelActive]}>
                {cat.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* ── Search results (flat) ───────────────────────────────────────────── */}
        {isSearch && (
          searchResults.length === 0 ? (
            <Text style={styles.empty}>No services found for "{search}"</Text>
          ) : (
            <>
              <Text style={styles.resultCount}>
                {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
              </Text>
              <ModuleGrid modules={searchResults} />
            </>
          )
        )}

        {/* ── Banded "All" view ───────────────────────────────────────────────── */}
        {!isSearch && activeCat === 'all' && bandsWithModules.map((band) => (
          <View key={band.key} style={styles.band}>
            <SectionHeader title={band.label} style={styles.bandHeader} />
            <Text style={styles.bandDesc}>{band.desc}</Text>
            <ModuleGrid modules={band.modules} />
          </View>
        ))}

        {/* ── Single-category filtered view ───────────────────────────────────── */}
        {!isSearch && activeCat !== 'all' && (
          singleCatModules.length === 0 ? (
            <Text style={styles.empty}>No services in this category</Text>
          ) : (
            <View style={styles.band}>
              {activeBandLabel && <SectionHeader title={activeBandLabel} style={styles.bandHeader} />}
              <ModuleGrid modules={singleCatModules} />
            </View>
          )
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  title:  { ...Typography.headlineMd, color: Colors.onSurface },

  chips:        { flexGrow: 0, marginBottom: Spacing.sm },
  chipsContent: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.xs,
    borderRadius:      Radius.full,
    backgroundColor:   Colors.surfaceContainerLow,
    borderWidth:       1,
    borderColor:       Colors.outlineVariant,
  },
  chipActive:      { backgroundColor: Colors.primaryContainer, borderColor: Colors.primaryContainer },
  chipLabel:       { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipLabelActive: { color: Colors.onPrimaryContainer },

  scroll: { paddingBottom: Platform.OS === 'ios' ? 100 : 80, paddingTop: Spacing.md },

  band:       { marginBottom: Spacing.xl },
  bandHeader: { marginBottom: Spacing.xs },
  bandDesc:   { ...Typography.bodySm, color: Colors.outline, paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.md },

  resultCount: { ...Typography.labelMd, color: Colors.outline, paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.md },
  empty:       { ...Typography.bodyMd, color: Colors.outline, textAlign: 'center', marginTop: Spacing.xxl, paddingHorizontal: Spacing.containerMargin },
});
