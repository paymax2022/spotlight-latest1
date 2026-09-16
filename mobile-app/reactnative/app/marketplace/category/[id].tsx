// ── Screen 5 — Category Landing ──────────────────────────────────────────────
// Category-specific browsing with schema-driven quick filters relevant only to
// this category (bedrooms for Property, mileage for Vehicles). Category hero,
// quick-filter chip row (config-driven from the category attribute schema),
// then straight into Results on chip tap. Same skeleton/empty pattern as Home.
import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { MarketColors } from '@/features/marketplace';
import type { CategoryQuickFilter } from '@/features/marketplace';
import { useCategory, useCategories, useSearch } from '@/features/marketplace/hooks';
import { subcategoriesOf, breadcrumb } from '@/features/marketplace/categoryTree';
import CategoryIcon from '@/features/marketplace/components/CategoryIcon';
import ListingCard from '@/features/marketplace/components/ListingCard';
import { GridSkeleton } from '@/features/marketplace/components/Skeletons';
import { HomeMenuButton } from '@/components/HomeMenu';

export default function CategoryLanding() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const category = useCategory(id!);
  // The flat list is already cached by the home grid, so the subcategory row
  // renders immediately rather than costing another round trip.
  const allCategories = useCategories();
  const subs = subcategoriesOf(allCategories.data, id!);
  const trail = breadcrumb(allCategories.data, id!);
  const preview = useSearch({ categoryId: id, sort: 'trusted_first', limit: 8 }, !!id);
  const results = preview.data?.results ?? [];

  const openFilter = (f: CategoryQuickFilter, value?: string) => {
    const p = new URLSearchParams();
    p.set('categoryId', id!);
    if (f.type === 'enum' && value) p.set(f.key, value);
    router.push(`/marketplace/results?${p.toString()}` as never);
  };


  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topRow}>
        <Pressable onPress={() => goBack('/marketplace')} hitSlop={10} accessibilityLabel="Back"><ArrowLeft size={22} color={Colors.onSurface} /></Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={styles.title} numberOfLines={1}>{category.data?.name ?? 'Category'}</Text>
          <HomeMenuButton />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Hero */}
        <View style={styles.hero}>
          <CategoryIcon
            category={category.data ?? {}}
            parent={trail.length > 1 ? trail[trail.length - 2] : undefined}
            size={64}
          />
          <View style={styles.heroText}>
            <Text style={styles.heroName}>{category.data?.name ?? '—'}</Text>
            {/* Only shown one level down, where it says something the title does
                not: which main this subcategory belongs to. */}
            {trail.length > 1 ? (
              <Text style={styles.heroTrail} numberOfLines={1}>
                {trail.slice(0, -1).map((c) => c.name).join(' › ')}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Subcategories */}
        {subs.length > 0 ? (
          <View style={styles.subBlock}>
            <Text style={styles.filterLabel}>Browse {category.data?.name ?? 'category'}</Text>
            <View style={styles.subGrid}>
              {subs.map((sc) => (
                <Pressable
                  key={sc.id}
                  style={styles.subTile}
                  onPress={() => router.push(`/marketplace/category/${sc.id}` as never)}
                  accessibilityRole="button"
                  accessibilityLabel={sc.name}
                >
                  {/* parent = the category being browsed, so every child puck
                      carries this main's hue. */}
                  <CategoryIcon category={sc} parent={category.data ?? undefined} size={28} />
                  <Text style={styles.subLabel} numberOfLines={2}>{sc.name}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {/* Schema-driven quick filters */}
        {(category.data?.quickFilters ?? []).map((f) => (
          <View key={f.key} style={styles.filterBlock}>
            <Text style={styles.filterLabel}>{f.label}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {(f.options ?? [{ value: '', label: f.type === 'range' ? 'Any' : 'All' }]).map((opt) => (
                <Pressable key={opt.value || 'any'} style={styles.chip} onPress={() => openFilter(f, opt.value)}>
                  <Text style={styles.chipText}>{opt.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ))}

        {/* Preview grid */}
        <View style={styles.previewHead}>
          <Text style={styles.previewTitle}>Popular in {category.data?.name ?? 'this category'}</Text>
          <Pressable onPress={() => router.push(`/marketplace/results?categoryId=${id}` as never)}><Text style={styles.seeAll}>See all</Text></Pressable>
        </View>

        {preview.isLoading && !preview.data ? (
          <GridSkeleton rows={2} />
        ) : results.length === 0 ? (
          <StateView kind="empty" icon="PackageOpen" title="No listings yet" message="Be the first to sell in this category." compact />
        ) : (
          <View style={styles.grid}>
            {results.map((l) => (
              <View key={l.id} style={styles.gridCell}>
                <ListingCard item={l} onPress={(lid) => router.push(`/marketplace/listing/${lid}?source=category` as never)} />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  title: { ...Typography.titleLg, color: Colors.onSurface, flex: 1 },
  scroll: { paddingBottom: Spacing.xxl },
  heroText: { alignItems: 'center', gap: 2 },
  heroTrail: { ...Typography.labelSm, color: Colors.onPrimaryContainer, opacity: 0.75 },
  subBlock: { paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.md, gap: Spacing.xs },
  subGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  subTile: { width: '30%', flexDirection: 'row', alignItems: 'center', gap: 6,
             backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.md,
             borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.sm },
  subIcon: { width: 28, height: 28, borderRadius: Radius.sm, backgroundColor: Colors.primaryContainer,
             alignItems: 'center', justifyContent: 'center' },
  subLabel: { ...Typography.caption, color: MarketColors.text, flex: 1 },
  hero: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.lg, backgroundColor: Colors.primaryContainer, marginHorizontal: Spacing.containerMargin, borderRadius: Radius.xl, marginBottom: Spacing.md },
  heroIcon: { width: 64, height: 64, borderRadius: Radius.lg, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  heroName: { ...Typography.titleLg, color: Colors.onPrimaryContainer },
  filterBlock: { paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.md, gap: 6 },
  filterLabel: { ...Typography.labelLg, color: MarketColors.text },
  chipRow: { gap: Spacing.xs, paddingRight: Spacing.containerMargin },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.full, backgroundColor: MarketColors.surfaceAlt, marginRight: Spacing.xs },
  chipText: { ...Typography.labelMd, color: MarketColors.text },
  previewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.sm, marginBottom: Spacing.sm },
  previewTitle: { ...Typography.titleMd, color: MarketColors.text, flex: 1 },
  seeAll: { ...Typography.labelMd, color: MarketColors.brand },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm },
  gridCell: { width: '48%' },
});
