// rails (Near you / Price drops / Escrow-eligible). Skeletons (not spinners),
// error we keep the last-known cache and show a subtle "saved results" banner.
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { WifiOff, Menu } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import SearchBar from '@/components/SearchBar';
import PromoBanner from '@/components/PromoBanner';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import { useDeviceCoords } from '@/features/location/useDeviceCoords';
import { MarketColors, discoveryApi } from '@/features/marketplace';
import { DEFAULT_RADIUS_KM } from '@/features/marketplace/proximity';
import type { BoostedListing, Category, ListingSummary } from '@/features/marketplace';
import { useCategories, useHomeRails } from '@/features/marketplace/hooks';
import { mainCategories, subcategoriesOf } from '@/features/marketplace/categoryTree';
import { useMarketplaceMenu } from '@/features/marketplace/components/MarketplaceMenu';
import ProximityBar from '@/features/marketplace/components/ProximityBar';
import { HomeMenuButton } from '@/components/HomeMenu';
import ListingCard from '@/features/marketplace/components/ListingCard';
import { CategoryGridSkeleton, RailSkeleton } from '@/features/marketplace/components/Skeletons';
import CategoryIcon from '@/features/marketplace/components/CategoryIcon';

// Six promoted cards on home, derived from the preview size getHomeRails() asks
// for (one more than this) rather than being a second number to keep in sync: the
// extra row is what tells a full-but-final page from a section with more behind it.
const HOME_BOOSTED_CAP = discoveryApi.HOME_BOOSTED_PREVIEW - 1;

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

function Rail({
  title,
  data,
  empty,
}: {
  title: string;
  data: ListingSummary[];
  /** Rendered in place of the cards when the rail has nothing. Omit it for a
      rail that should simply not appear (e.g. Price drops, mock-only). */
  empty?: { title: string; message: string; icon: string };
}) {
  if (data.length === 0 && !empty) return null;
  return (
    <View style={styles.railWrap}>
      <SectionHeader title={title} />
      {data.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
          {data.map((l) => (
            <ListingCard key={l.id} item={l} horizontal onPress={(id) => router.push(`/marketplace/listing/${id}?source=home` as never)} />
          ))}
        </ScrollView>
      ) : (
        <StateView kind="empty" compact icon={empty!.icon} title={empty!.title} message={empty!.message} />
      )}
    </View>
  );
}

// The promoted section sits directly under the category grid and above "Near you"
// — a seller paying for visibility is buying placement in the first thing a buyer
// sees, not a rail they have to scroll past three others to reach.
//
// It is capped at 6 cards, and the door behind it appears only when the fetch came
// back with a 7th (HOME_BOOSTED_PREVIEW): six cards with nothing behind them would
// offer a "View More" that leads to the same six. With nothing promoted at all the
// section is hidden rather than rendering a heading over an empty row.
//
// The order is the server's — most UNSPENT boost value first — and is never
// re-sorted here.
function BoostedRail({ data }: { data: BoostedListing[] }) {
  if (data.length === 0) return null;
  return (
    <View style={styles.railWrap}>
      <SectionHeader
        title="Boosted"
        actionLabel={data.length > HOME_BOOSTED_CAP ? 'View More' : undefined}
        onAction={data.length > HOME_BOOSTED_CAP ? () => router.push('/marketplace/boosted' as never) : undefined}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
        {data.slice(0, HOME_BOOSTED_CAP).map((l) => (
          <ListingCard key={l.id} item={l} horizontal onPress={(id) => router.push(`/marketplace/listing/${id}?source=boosted` as never)} />
        ))}
      </ScrollView>
    </View>
  );
}

export default function MarketplaceHome() {
  const menu = useMarketplaceMenu();
  const categories = useCategories();
  // Proximity is opt-in and per-device: the bar below asks, and a denied answer
  // becomes a visible state with a retry rather than a dialog repeated on every
  // tab switch. Until it is granted, "Near you" stays empty on purpose.
  const loc = useDeviceCoords();
  const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS_KM);
  const rails = useHomeRails(loc.coords, radiusKm);
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
        <View style={{ flex: 1 }} />
        <HomeMenuButton />
      </View>

      {/* Hero banner - link to seller onboarding */}
      <PromoBanner
        imageUri="https://res.cloudinary.com/paymax/image/upload/v1792917802/Premium_purple_marketplace_seller_banner_1_tomt8d.png"
        onPress={() => router.push('/marketplace/sell' as never)}
      />

      {/* SearchBar is now editable and opens on the same page */}
      <SearchBar
        editable={true}
        placeholder="Search phones, cars, furniture…"
      />

      <View style={styles.proximity}>
        <ProximityBar
          surface="home"
          coords={loc.coords}
          loading={loc.loading}
          error={loc.error}
          available={loc.available}
          onAsk={() => void loc.request()}
          onClear={loc.clear}
          radiusKm={radiusKm}
          // This rail IS a radius query, so clearing a chip resets to the default
          // instead of asking for "everything within no distance".
          onRadius={(km) => setRadiusKm(km ?? DEFAULT_RADIUS_KM)}
        />
      </View>

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
        {/* Category grid — three states: loading (no data yet), a hard first-load
            failure (no cache to fall back to, so the grid would otherwise render
            silently empty), and success. A fetch that fails AFTER cached data
            exists is handled separately by showCacheBanner above; this is only
            for the cold-start case that banner doesn't cover. */}
        {categories.isLoading && !categories.data ? (
          <CategoryGridSkeleton />
        ) : categories.isError && !categories.data ? (
          <StateView
            kind="error"
            compact
            title="Couldn't load categories"
            message="Check your connection and try again."
            actionLabel="Retry"
            onAction={() => categories.refetch()}
          />
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

        {/* Rails — same three-state handling. getHomeRails() swallows each
            rail's own search failure into an empty array (a broken "Near you"
            rail shouldn't blank the whole home screen), so rails.isError only
            fires for a failure outside that per-rail guard; still handled here
            rather than left to render nothing with no way to retry. */}
        {rails.isLoading && !rails.data ? (
          <View style={styles.railsLoading}>
            <SectionHeader title="Near you" />
            <RailSkeleton />
          </View>
        ) : rails.isError && !rails.data ? (
          <StateView
            kind="error"
            compact
            title="Couldn't load listings"
            message="Check your connection and try again."
            actionLabel="Retry"
            onAction={() => rails.refetch()}
          />
        ) : (
          <>
            <BoostedRail data={rails.data?.boosted ?? []} />
            <Rail
              title={loc.coords ? `Near you · within ${radiusKm} km` : 'Near you'}
              data={rails.data?.nearYou ?? []}
              empty={
                loc.coords
                  ? {
                      title: `Nothing listed within ${radiusKm} km`,
                      message: 'Try a wider radius above — new posts from sellers around you appear here.',
                      icon: 'MapPin',
                    }
                  : {
                      title: 'Nothing near you yet',
                      message: 'Turn on location above to measure how far each item actually is.',
                      icon: 'MapPin',
                    }
              }
            />
            <Rail title="Price drops" data={rails.data?.priceDrops ?? []} />
            <Rail
              title="Escrow-eligible"
              data={rails.data?.escrowEligible ?? []}
              empty={{
                title: 'No escrow-eligible listings',
                message: 'Sellers can protect a deal with escrow from their listing settings.',
                icon: 'ShieldCheck',
              }}
            />
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
  cacheBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: MarketColors.warnBg, marginHorizontal: Spacing.containerMargin, paddingHorizontal: Spacing.sm, paddingVertical: 6, borderRadius: Radius.md, marginBottom: Spacing.xs },
  proximity: { marginTop: -2, marginBottom: Spacing.sm },
  cacheBannerText: { ...Typography.labelSm, color: MarketColors.warnText },
  scroll: { paddingBottom: Spacing.xxl },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, marginBottom: Spacing.md },
  catTile: { width: '21%', alignItems: 'center', gap: 6 },
  catIconWrap: { width: 56, height: 56 },
  catBadge: { position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, paddingHorizontal: 4,
              borderRadius: 9, backgroundColor: MarketColors.brand, alignItems: 'center', justifyContent: 'center' },
  catBadgeText: { ...Typography.caption, color: Colors.onPrimary, fontSize: 10, lineHeight: 14 },
  // minHeight keeps one- and two-line tiles on the same baseline.
  catLabel: { ...Typography.labelSm, color: MarketColors.text, textAlign: 'center', minHeight: 30 },
  railsLoading: { marginTop: Spacing.sm },
  railWrap: { marginTop: Spacing.sm },
  rail: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.xs },
});
