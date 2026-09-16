// ── Screen 1 — Marketplace Home ──────────────────────────────────────────────
// Zero-effort browsing; surfaces trust and value before search. Category grid +
// rails (Near you / Price drops / Escrow-eligible). Skeletons (not spinners),
// offline-cached content renders instantly then refreshes silently; on network
// error we keep the last-known cache and show a subtle "saved results" banner.
import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { WifiOff, Menu } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import SearchBar from '@/components/SearchBar';
import SectionHeader from '@/components/SectionHeader';
import { MarketColors } from '@/features/marketplace';
import type { Category, ListingSummary } from '@/features/marketplace';
import { useCategories, useHomeRails } from '@/features/marketplace/hooks';
import { mainCategories, subcategoriesOf } from '@/features/marketplace/categoryTree';
import { useMarketplaceMenu } from '@/features/marketplace/components/MarketplaceMenu';
import ListingCard from '@/features/marketplace/components/ListingCard';
import { CategoryGridSkeleton, RailSkeleton } from '@/features/marketplace/components/Skeletons';
import CategoryIcon from '@/features/marketplace/components/CategoryIcon';

function CategoryTile({ category, subCount }: { category: Category; subCount: number }) {
  // Icon + colour come from CategoryIcon: curated hues for the 12 mains, and the
  // server's icon column (migration 20270123000000) for the subcategories, which
  // inherit their parent's hue. Before that column existed `category.icon` was
  // undefined for every row and the `?? 'Package'` fallback rendered them alike.
  return (
    <Pressable
      style={styles.catTile}
      onPress={() => router.push(`/marketplace/category/${category.id}` as never)}
      accessibilityRole="button"
      accessibilityLabel={subCount > 0
        ? `${category.name}, ${subCount} subcategories`
        : category.name}
    >
      <View style={styles.catIconWrap}>
        <CategoryIcon category={category} size={56} />
        {subCount > 0 ? (
          <View style={styles.catBadge}><Text style={styles.catBadgeText}>{subCount}</Text></View>
        ) : null}
      </View>
      <Text style={styles.catLabel} numberOfLines={2}>{category.name}</Text>
    </Pressable>
  );
}

function Rail({ title, data }: { title: string; data: ListingSummary[] }) {
  if (data.length === 0) return null;
  return (
    <View style={styles.railWrap}>
      <SectionHeader title={title} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
        {data.map((l) => (
          <ListingCard key={l.id} item={l} horizontal onPress={(id) => router.push(`/marketplace/listing/${id}?source=home` as never)} />
        ))}
      </ScrollView>
    </View>
  );
}

export default function MarketplaceHome() {
  const menu = useMarketplaceMenu();
  const categories = useCategories();
  const rails = useHomeRails();
  const refreshing = categories.isFetching || rails.isFetching;
  // Offline-first: if a fetch failed but we still hold cached data, show it with a banner.
  const showCacheBanner = (categories.isError || rails.isError) && (!!categories.data || !!rails.data);

  const onRefresh = () => {
    categories.refetch();
    rails.refetch();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={menu.open} hitSlop={8} style={styles.menuBtn} accessibilityRole="button" accessibilityLabel="Open menu">
          <Menu size={24} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <Text style={styles.headerTitle}>Marketplace</Text>
      </View>

      <Pressable onPress={() => router.push('/marketplace/search' as never)} accessibilityRole="button" accessibilityLabel="Search marketplace">
        <View style={styles.searchWrap} pointerEvents="none">
          <SearchBar editable={false} placeholder="Search phones, cars, furniture…" />
        </View>
      </Pressable>

      {showCacheBanner ? (
        <View style={styles.cacheBanner}>
          <WifiOff size={14} color={MarketColors.warnText} />
          <Text style={styles.cacheBannerText}>Showing saved results — pull to refresh</Text>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={MarketColors.brand} />}
      >
        {/* Category grid */}
        {categories.isLoading && !categories.data ? (
          <CategoryGridSkeleton />
        ) : (
          <View style={styles.catGrid}>
            {/* The 12 MAINS only. Rendering the flat list here put all 84 rows —
                every subcategory alongside its own parent — into one grid. */}
            {mainCategories(categories.data).map((c) => (
              <CategoryTile
                key={c.id}
                category={c}
                subCount={subcategoriesOf(categories.data, c.id).length}
              />
            ))}
          </View>
        )}

        {/* Rails */}
        {rails.isLoading && !rails.data ? (
          <View style={styles.railsLoading}>
            <SectionHeader title="Near you" />
            <RailSkeleton />
          </View>
        ) : (
          <>
            <Rail title="Near you" data={rails.data?.nearYou ?? []} />
            <Rail title="Price drops" data={rails.data?.priceDrops ?? []} />
            <Rail title="Escrow-eligible" data={rails.data?.escrowEligible ?? []} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  menuBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: -6 },
  headerTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  searchWrap: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.sm },
  cacheBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: MarketColors.warnBg, marginHorizontal: Spacing.containerMargin, paddingHorizontal: Spacing.sm, paddingVertical: 6, borderRadius: Radius.md, marginBottom: Spacing.xs },
  cacheBannerText: { ...Typography.labelSm, color: MarketColors.warnText },
  scroll: { paddingBottom: Spacing.xxl },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, marginBottom: Spacing.md },
  catTile: { width: '21%', alignItems: 'center', gap: 6 },
  catIconWrap: { width: 56, height: 56 },
  catBadge: { position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, paddingHorizontal: 4,
              borderRadius: 9, backgroundColor: MarketColors.brand, alignItems: 'center', justifyContent: 'center' },
  catBadgeText: { ...Typography.caption, color: Colors.onPrimary, fontSize: 10, lineHeight: 14 },
  // Two lines so "Motorcycles & Scooters" is readable at a 4-per-row width;
  // minHeight keeps one- and two-line tiles on the same baseline.
  catLabel: { ...Typography.labelSm, color: MarketColors.text, textAlign: 'center', minHeight: 30 },
  railsLoading: { marginTop: Spacing.sm },
  railWrap: { marginTop: Spacing.sm },
  rail: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.xs },
});
