import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { LinearGradient } from 'expo-linear-gradient';
import * as Icons from 'lucide-react-native';
import SearchBar from '@/components/SearchBar';
import StateView from '@/components/StateView';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1, shadow2, shadow3 } from '@/constants/shadows';
import { useRestaurantSearch } from '@/features/food/hooks';
import { useDebouncedValue } from '@/features/food/useDebouncedValue';
import { useDeviceCoords } from '@/features/food/useDeviceCoords';
import { useCartStore, cartItemCount } from '@/features/food/cartStore';
import { formatNairaWhole } from '@/features/food/utils';
import { DynamicIcon } from '@/features/food/components';
import type { Restaurant } from '@/features/food/types';

const CUISINE_FILTERS = [
  { key: 'all', label: 'All', icon: 'LayoutGrid' },
  { key: 'local', label: 'Local', icon: 'Soup' },
  { key: 'fast', label: 'Fast Food', icon: 'Zap' },
  { key: 'chinese', label: 'Chinese', icon: 'UtensilsCrossed' },
  { key: 'grills', label: 'Grills', icon: 'Flame' },
  { key: 'healthy', label: 'Healthy', icon: 'Leaf' },
] as const;
type Cuisine = (typeof CUISINE_FILTERS)[number]['key'];

/**
 * There is no restaurant photography pipeline (no image field on Restaurant,
 * no upload flow) — the discovery cards never had a photo to show. This
 * palette stands in for that: each restaurant gets a deterministic gradient
 * "cover" (same card always gets the same one, no flicker on reload) so the
 * list has the visual variety a photo grid would, without inventing images
 * that don't exist. A stable string hash, not Math.random — id order must
 * not affect the pick.
 */
const COVER_GRADIENTS: [string, string][] = [
  ['#F97316', '#C2410C'], // tomato
  ['#DB2777', '#831843'], // wine
  ['#65A30D', '#14532D'], // herb
  ['#FBBF24', '#B45309'], // golden
  ['#14B8A6', '#134E4A'], // ocean
  ['#EF4444', '#7F1D1D'], // deep red
];
function coverGradient(id: string): [string, string] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COVER_GRADIENTS[h % COVER_GRADIENTS.length];
}

/**
 * Browse views reachable from the "Browse" tiles on /services/food, passed in as
 * ?view=. Each one re-orders or narrows the same restaurant list — they are not
 * separate screens, so the cuisine chips and search keep working on top of them.
 *
 * Each view is expressed as SERVER query params. They used to be applied to an
 * in-memory copy of the whole list, which stopped being possible once the list
 * was paged: sorting or filtering only the rows already downloaded would have
 * shown a "Popular" tab of whichever 20 restaurants happened to load first.
 */
const BROWSE_VIEWS = {
  nearby:  { label: 'Nearby',  icon: 'MapPin', params: { sort: 'eta' } },
  popular: { label: 'Popular', icon: 'Flame',  params: { sort: 'rating' } },
  offers:  { label: 'Offers',  icon: 'Tag',    params: { promo: true } },
} as const;
type BrowseView = keyof typeof BROWSE_VIEWS;

function asBrowseView(v: unknown): BrowseView | null {
  return typeof v === 'string' && v in BROWSE_VIEWS ? (v as BrowseView) : null;
}

function RestaurantCard({ item, onPress }: { item: Restaurant; onPress: () => void }) {
  const [coverStart, coverEnd] = coverGradient(item.id);
  return (
    <Pressable
      onPress={onPress}
      disabled={!item.isOpen}
      style={({ pressed }) => [rc.card, shadow2, pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] }, !item.isOpen && { opacity: 0.7 }]}
      accessibilityRole="button"
    >
      <LinearGradient colors={[coverStart, coverEnd]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={rc.cover}>
        <View style={rc.coverIconRing}>
          <DynamicIcon name={item.icon} color={Colors.white} size={30} strokeWidth={1.6} />
        </View>

        <View style={rc.ratingBadge}>
          <Icons.Star size={11} color={Colors.gold} fill={Colors.gold} strokeWidth={0} />
          <Text style={rc.ratingText}>{item.rating.toFixed(1)}</Text>
        </View>

        {item.promo ? (
          <View style={rc.promoRibbon}>
            <Text style={rc.promoText} numberOfLines={1}>{item.promo}</Text>
          </View>
        ) : null}

        {!item.isOpen ? (
          <View style={rc.closedScrim}>
            <Text style={rc.closedLabel}>Closed</Text>
          </View>
        ) : null}
      </LinearGradient>

      <View style={rc.body}>
        <View style={rc.nameRow}>
          <Text style={rc.name} numberOfLines={1}>{item.name}</Text>
          <Icons.ChevronRight size={16} color={Colors.outline} strokeWidth={2.2} />
        </View>

        <View style={rc.tagRow}>
          {item.tags.slice(0, 3).map((t) => (
            <View key={t} style={rc.tagChip}>
              <Text style={rc.tagText}>{t}</Text>
            </View>
          ))}
        </View>

        <View style={rc.metaRow}>
          <View style={rc.metaItem}>
            <Icons.Clock size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={rc.metaText}>{item.etaLabel}</Text>
          </View>
          <View style={rc.metaDivider} />
          <View style={rc.metaItem}>
            <Icons.Wallet size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={rc.metaText}>Min {formatNairaWhole(item.minOrderKobo)}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const CARD_RADIUS = Radius.xl;
const rc = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
    marginBottom: Spacing.lg,
  },
  cover: { height: 108, justifyContent: 'center', alignItems: 'center' },
  coverIconRing: {
    width: 60, height: 60, borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  ratingBadge: {
    position: 'absolute', top: Spacing.sm, right: Spacing.sm,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4,
  },
  ratingText: { ...Typography.labelSm, color: Colors.onSurface },
  promoRibbon: {
    position: 'absolute', top: Spacing.sm, left: Spacing.sm, maxWidth: '60%',
    backgroundColor: Colors.onSurface, borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 4,
  },
  promoText: { ...Typography.labelSm, color: Colors.white },
  closedScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(11,28,48,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  closedLabel: { ...Typography.labelLg, color: Colors.white },
  body: { padding: Spacing.md, gap: Spacing.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  name: { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tagChip: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 3 },
  tagText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 2 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaDivider: { width: 1, height: 12, backgroundColor: Colors.outlineVariant },
  metaText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});

export default function FoodDiscoveryScreen() {
  const params = useLocalSearchParams<{ view?: string }>();
  const [cuisine, setCuisine] = useState<Cuisine>('all');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<BrowseView | null>(() => asBrowseView(params.view));
  const cartPackages = useCartStore((s) => s.packages);
  const cartCount = cartItemCount(cartPackages);

  // Expo Router can hand this screen a new ?view= without remounting it (e.g.
  // navigating Browse → Nearby, back, then Browse → Offers), so mirror the param
  // instead of only seeding state on mount.
  useEffect(() => {
    setView(asBrowseView(params.view));
  }, [params.view]);

  const viewMeta = view ? BROWSE_VIEWS[view] : null;
  const debouncedSearch = useDebouncedValue(search);

  // "Nearby" wants a real proximity sort, which needs the device's own
  // coordinates. Request them the moment the view is entered rather than
  // eagerly on every screen load — most visits never touch this tile, and
  // asking only when it's actually wanted keeps the permission prompt tied to
  // something the user just did. Until coords resolve (or if the device/user
  // declines), the query below falls back to the same kitchen-speed proxy
  // "Nearby" already used — never a broken or empty view.
  const deviceCoords = useDeviceCoords();
  useEffect(() => {
    if (view === 'nearby' && !deviceCoords.coords && deviceCoords.available) {
      void deviceCoords.request();
    }
    // deviceCoords itself is a fresh object every render; only `view` should
    // retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const nearbyParams =
    view === 'nearby' && deviceCoords.coords
      ? { sort: 'distance' as const, nearLat: deviceCoords.coords.lat, nearLng: deviceCoords.coords.lng }
      : viewMeta?.params;

  // Every filter is a SERVER param. `restaurants` below is the pages loaded so
  // far; `total` is every match, which is what the counts must report — saying
  // "20 open" while 2,016 match would be worse than saying nothing.
  const {
    items: restaurants,
    total,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useRestaurantSearch({
    q: debouncedSearch,
    cuisine: cuisine === 'all' ? '' : cuisine,
    ...(nearbyParams ?? {}),
  });

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.topBar}>
        <Pressable onPress={() => goBack('/')} style={s.iconButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icons.ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={s.topTitle}>Food & Delivery</Text>
        <View style={s.topActions}>
          {/* The owner console has always lived at /food/restaurant/* with nothing
              linking to it from the customer screens. */}
          <Pressable
            style={s.iconButton}
            onPress={() => router.push('/food/restaurant')}
            accessibilityRole="button"
            accessibilityLabel="Restaurant owner dashboard"
          >
            <Icons.Store size={21} color={Colors.primary} strokeWidth={2} />
          </Pressable>
          <Pressable
            style={s.iconButton}
            onPress={() => router.push('/food/orders')}
            accessibilityRole="button"
            accessibilityLabel="My orders"
          >
            <Icons.ReceiptText size={21} color={Colors.primary} strokeWidth={2} />
          </Pressable>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        <LinearGradient colors={['#FB923C', '#EF4444', '#7F1D1D']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.hero, shadow2]}>
          <View style={s.heroWatermark}>
            <Icons.ChefHat size={140} color="rgba(255,255,255,0.10)" strokeWidth={1} />
          </View>
          <View style={s.heroEyebrow}>
            <Icons.Sparkles size={12} color={Colors.white} strokeWidth={2} />
            <Text style={s.heroEyebrowText}>Paymax Food</Text>
          </View>
          <Text style={s.heroTitle}>Hungry?{'\n'}Order now</Text>
          <Text style={s.heroSubtitle}>Restaurants near you, live tracked delivery — pay with your Paymax wallet.</Text>
        </LinearGradient>

        <View style={s.searchFloat}>
          <SearchBar value={search} onChangeText={setSearch} placeholder="Search restaurant or dish…" />
        </View>

        {/* Becoming a seller had exactly one door: the unlabelled store glyph in
            the top bar, which nobody looking to sell food would think to press.
            The console it opens has always carried the whole flow — create the
            store, set the packaging price, build the menu — so what was missing
            was a way to find out it exists. Say it in words, above the fold.
            Below the search rather than above it: the search floats UP over the
            hero (searchFloat's negative margin), so anything between the two
            breaks that overlap. */}
        <Pressable
          onPress={() => router.push('/food/restaurant')}
          style={({ pressed }) => [s.sellRow, pressed && { opacity: 0.9 }]}
          accessibilityRole="button"
          accessibilityLabel="Sell food on Paymax — set up your restaurant"
        >
          <View style={s.sellIcon}>
            <Icons.ChefHat size={20} color={Colors.primary} strokeWidth={2} />
          </View>
          <View style={s.sellText}>
            <Text style={s.sellTitle}>Sell food on Paymax</Text>
            <Text style={s.sellSub}>Set up your restaurant, add your menu, start taking orders.</Text>
          </View>
          <Icons.ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
        </Pressable>

        {/* Active browse view (arrived via ?view=), clearable back to the full list */}
        {viewMeta ? (
          <View style={s.viewPillRow}>
            <Pressable
              onPress={() => setView(null)}
              style={({ pressed }) => [s.viewPill, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={`Clear ${viewMeta.label} filter`}
            >
              <DynamicIcon name={viewMeta.icon} color={Colors.white} size={14} />
              <Text style={s.viewPillLabel}>{viewMeta.label}</Text>
              <Icons.X size={14} color={Colors.white} strokeWidth={2.4} />
            </Pressable>
          </View>
        ) : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips} contentContainerStyle={s.chipsContent}>
          {CUISINE_FILTERS.map((f) => {
            const active = cuisine === f.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => setCuisine(f.key)}
                style={({ pressed }) => [s.chip, active && s.chipActive, active && shadow1, pressed && { opacity: 0.9 }]}
              >
                <DynamicIcon name={f.icon} color={active ? Colors.white : Colors.onSurfaceVariant} size={15} strokeWidth={2} />
                <Text style={[s.chipLabel, active && s.chipLabelActive]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>
            {viewMeta
              ? viewMeta.label
              : cuisine === 'all'
                ? 'All Restaurants'
                : CUISINE_FILTERS.find((f) => f.key === cuisine)?.label}
          </Text>
          {!isLoading && !isError ? (
            <View style={s.sectionMetaBadge}>
              <Text style={s.sectionMeta}>
                {restaurants.length < total ? `${restaurants.length} of ${total.toLocaleString('en-NG')}` : `${total.toLocaleString('en-NG')} open`}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={s.list}>
          {isLoading ? (
            <StateView kind="loading" message="Finding restaurants near you…" />
          ) : isError ? (
            <StateView kind="error" title="Couldn't load restaurants" message="Check your connection and try again." actionLabel="Retry" onAction={() => refetch()} />
          ) : restaurants.length === 0 ? (
            <StateView
              kind="empty"
              icon="SearchX"
              title="No restaurants found"
              message={
                debouncedSearch
                  ? `Nothing matches "${debouncedSearch}".`
                  : view === 'offers'
                    ? 'No restaurants are running offers right now.'
                    : 'Try a different cuisine filter.'
              }
              actionLabel={viewMeta ? `Show all restaurants` : undefined}
              onAction={viewMeta ? () => setView(null) : undefined}
            />
          ) : (
            <>
              {restaurants.map((item) => (
                <RestaurantCard key={item.id} item={item} onPress={() => router.push(`/food/restaurant/${item.id}`)} />
              ))}
              {hasNextPage ? (
                <Pressable
                  onPress={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  style={({ pressed }) => [s.loadMore, pressed && { opacity: 0.85 }, isFetchingNextPage && { opacity: 0.6 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Load more restaurants"
                >
                  <Text style={s.loadMoreLabel}>
                    {isFetchingNextPage ? 'Loading…' : `Load more (${(total - restaurants.length).toLocaleString('en-NG')} left)`}
                  </Text>
                  {!isFetchingNextPage && <Icons.ChevronDown size={16} color={Colors.white} strokeWidth={2.4} />}
                </Pressable>
              ) : (
                <Text style={s.listEnd}>That's all {total.toLocaleString('en-NG')} of them.</Text>
              )}
            </>
          )}
        </View>
      </ScrollView>

      {/* Cart bar */}
      {cartCount > 0 ? (
        <Pressable onPress={() => router.push('/food/checkout')} accessibilityRole="button">
          <LinearGradient colors={['#FB923C', '#EF4444']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[s.cartBar, shadow3]}>
            <View style={s.cartIconBadge}>
              <Icons.ShoppingCart size={16} color={Colors.white} strokeWidth={2.2} />
            </View>
            <Text style={s.cartText}>{cartCount} item{cartCount > 1 ? 's' : ''} in cart</Text>
            <View style={s.cartCtaPill}>
              <Text style={s.cartCta}>Checkout</Text>
              <Icons.ArrowRight size={14} color="#EF4444" strokeWidth={2.4} />
            </View>
          </LinearGradient>
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    height: 64,
    paddingHorizontal: Spacing.containerMargin,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(248,249,255,0.92)',
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceContainerHigh,
  },
  iconButton: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  topTitle: { ...Typography.titleLg, color: Colors.primary },
  content: { paddingTop: 0, paddingBottom: Platform.OS === 'ios' ? 140 : 120 },
  hero: {
    minHeight: 200,
    borderBottomLeftRadius: Radius.xxl,
    borderBottomRightRadius: Radius.xxl,
    padding: Spacing.cardPadding,
    paddingTop: Spacing.lg,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  heroWatermark: { position: 'absolute', right: -24, top: -20 },
  heroEyebrow: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 4,
  },
  heroEyebrowText: { ...Typography.labelSm, color: Colors.white },
  heroTitle: { ...Typography.headlineLg, color: Colors.white, marginTop: Spacing.sm },
  heroSubtitle: { ...Typography.bodySm, color: 'rgba(255,255,255,0.88)', marginTop: Spacing.sm, marginBottom: Spacing.lg, maxWidth: '85%' },
  searchFloat: { marginTop: -26, marginBottom: Spacing.xs, zIndex: 2 },
  sellRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.containerMargin,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
  },
  sellIcon: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  sellText: { flex: 1, gap: 2 },
  sellTitle: { ...Typography.labelLg, color: Colors.onSurface },
  sellSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  viewPillRow: { flexDirection: 'row', paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.sm },
  viewPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EF4444',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  viewPillLabel: { ...Typography.labelMd, color: Colors.white },
  chips: { flexGrow: 0, marginTop: Spacing.md },
  chipsContent: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  chipActive: { backgroundColor: '#EF4444', borderColor: '#EF4444' },
  chipLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipLabelActive: { color: Colors.white },
  sectionHeader: { paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.lg, marginBottom: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { ...Typography.titleLg, color: Colors.onSurface },
  sectionMetaBadge: { backgroundColor: Colors.iconBgOrange, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  sectionMeta: { ...Typography.labelSm, color: '#C2410C' },
  list: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, minHeight: 200 },
  loadMore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: '#EF4444',
    marginBottom: Spacing.md,
  },
  loadMoreLabel: { ...Typography.labelMd, color: Colors.white },
  listEnd: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', paddingVertical: Spacing.md },
  cartBar: {
    position: 'absolute',
    left: Spacing.containerMargin,
    right: Spacing.containerMargin,
    bottom: Platform.OS === 'ios' ? 32 : 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  cartIconBadge: {
    width: 32, height: 32, borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center',
  },
  cartText: { ...Typography.labelMd, color: Colors.white, flex: 1 },
  cartCtaPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.white, borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  cartCta: { ...Typography.labelMd, color: '#EF4444' },
});
