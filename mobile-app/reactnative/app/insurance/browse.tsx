// ── Protection — browse the live catalog ─────────────────────────────────────
// All 68 real MyCover plans, grouped by the 7 real categories.
//
// 68 rows in one flat list is a data dump, so: a category filter row, a search
// that matches plan name / insurer / description, and — when no category is
// selected — the catalog is presented as sections with counts rather than one
// undifferentiated scroll. Underwriter filtering matters too, because "which of
// these is Leadway?" is a real question people ask about insurance.

import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { SlidersHorizontal } from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import SearchBar from '@/components/SearchBar';
import SegmentedControl from '@/components/SegmentedControl';
import StateView from '@/components/StateView';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import {
  InsuranceErrorState,
  LiveProductCard,
  ProductListSkeleton,
} from '@/features/insurance/components/live';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';
import { CATEGORIES, categoryMeta, filterProducts } from '@/features/insurance/live/catalog';
import { useLiveProducts } from '@/features/insurance/live/hooks';
import type { Product } from '@/features/insurance/live/types';

const ALL = 'all';

type Row =
  | { kind: 'section'; key: string; title: string; subtitle: string; count: number }
  | { kind: 'product'; key: string; product: Product };

export default function BrowseScreen() {
  const params = useLocalSearchParams<{ line?: string }>();
  const initial =
    params.line && CATEGORIES.some((c) => c.line === params.line) ? String(params.line) : ALL;

  const [line, setLine] = useState<string>(initial);
  const [query, setQuery] = useState('');
  const [underwriter, setUnderwriter] = useState<string | null>(null);

  // The whole catalog is fetched once and filtered locally: 68 rows is small,
  // and it makes category switching and search instant instead of a round trip.
  const products = useLiveProducts();
  const catalog = products.data ?? [];

  const underwriters = useMemo(
    () =>
      Array.from(new Set(catalog.filter((p) => p.active).map((p) => p.underwriter).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b)),
    [catalog],
  );

  const matched = useMemo(() => {
    const base = filterProducts(catalog, { line: line === ALL ? null : line, query });
    return underwriter ? base.filter((p) => p.underwriter === underwriter) : base;
  }, [catalog, line, query, underwriter]);

  // With no category chosen, present sections instead of one long list.
  const rows: Row[] = useMemo(() => {
    if (line !== ALL) {
      return matched.map((p) => ({ kind: 'product' as const, key: p.code, product: p }));
    }
    const out: Row[] = [];
    for (const meta of CATEGORIES) {
      const inLine = matched.filter((p) => p.productLine === meta.line);
      if (!inLine.length) continue;
      out.push({
        kind: 'section',
        key: `sec-${meta.line}`,
        title: meta.label,
        subtitle: meta.description,
        count: inLine.length,
      });
      for (const p of inLine) out.push({ kind: 'product', key: p.code, product: p });
    }
    return out;
  }, [matched, line]);

  const filters = useMemo(
    () => [
      { value: ALL, label: `All${catalog.length ? ` (${catalog.length})` : ''}` },
      ...CATEGORIES.map((c) => ({ value: c.line as string, label: c.label })),
    ],
    [catalog.length],
  );

  const activeMeta = line === ALL ? null : categoryMeta(line);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title={activeMeta ? activeMeta.label : 'Find cover'}
        subtitle={
          products.isLoading
            ? 'Loading live plans…'
            : `${matched.length} of ${catalog.length} plans`
        }
      />

      <View style={styles.controls}>
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder="Search plans or insurers"
        />
        <SegmentedControl options={filters} value={line} onChange={setLine} scrollable />
        {underwriters.length > 1 ? (
          <UnderwriterFilter
            underwriters={underwriters}
            value={underwriter}
            onChange={setUnderwriter}
          />
        ) : null}
      </View>

      {products.isLoading ? (
        <ProductListSkeleton count={4} />
      ) : products.isError ? (
        <InsuranceErrorState error={products.error} onRetry={() => products.refetch()} />
      ) : rows.length === 0 ? (
        <StateView
          kind="empty"
          title={query || underwriter ? 'Nothing matches that' : 'No plans in this category'}
          message={
            query || underwriter
              ? 'Try a different search, or clear the filters to see every plan.'
              : 'This category has no plans available right now. Try another one.'
          }
          icon="Umbrella"
          actionLabel={query || underwriter ? 'Clear filters' : 'See all plans'}
          onAction={() => {
            setQuery('');
            setUnderwriter(null);
            setLine(ALL);
          }}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            activeMeta ? <Text style={styles.lineIntro}>{activeMeta.description}</Text> : null
          }
          renderItem={({ item }) =>
            item.kind === 'section' ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{item.title}</Text>
                <Text style={styles.sectionCount}>
                  {item.count} {item.count === 1 ? 'plan' : 'plans'}
                </Text>
              </View>
            ) : (
              <LiveProductCard
                product={item.product}
                onPress={() =>
                  router.push(`/insurance/product/${encodeURIComponent(item.product.code)}`)
                }
              />
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

/** Horizontal insurer chips — "show me only Leadway" is a real question. */
function UnderwriterFilter({
  underwriters,
  value,
  onChange,
}: {
  underwriters: string[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  if (!open && !value) {
    return (
      <Pressable style={styles.filterToggle} onPress={() => setOpen(true)} accessibilityRole="button">
        <SlidersHorizontal size={15} color={Colors.onSurfaceVariant} />
        <Text style={styles.filterToggleLabel}>Filter by insurer</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.chipRow}>
      <Pressable
        style={[styles.chip, !value && styles.chipActive]}
        onPress={() => onChange(null)}
        accessibilityRole="button"
      >
        <Text style={[styles.chipLabel, !value && styles.chipLabelActive]}>Any insurer</Text>
      </Pressable>
      {underwriters.map((u) => {
        const active = u === value;
        return (
          <Pressable
            key={u}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onChange(active ? null : u)}
            accessibilityRole="button"
          >
            <Text style={[styles.chipLabel, active && styles.chipLabelActive]} numberOfLines={1}>
              {u}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  controls: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: Spacing.sm },
  list: {
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.xs,
    paddingBottom: 56,
    gap: Spacing.md,
  },
  lineIntro: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
  section: { marginTop: Spacing.sm },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  sectionCount: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },

  filterToggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingVertical: 2 },
  filterToggleLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: InsuranceColors.border,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  chipActive: { backgroundColor: Colors.iconBgPurple, borderColor: InsuranceColors.brand },
  chipLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, maxWidth: 180 },
  chipLabelActive: { color: InsuranceColors.brand, fontWeight: '700' as const },
});
