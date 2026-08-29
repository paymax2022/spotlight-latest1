import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { LinearGradient } from 'expo-linear-gradient';
import * as Icons from 'lucide-react-native';
import SearchBar from '@/components/SearchBar';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1, shadow2 } from '@/constants/shadows';
import { useRestaurantSearch } from '@/features/food/hooks';
import { useDebouncedValue } from '@/features/food/useDebouncedValue';
import { useMyStores } from '@/features/restaurantmerchant/hooks';
import { useCartStore, cartItemCount } from '@/features/food/cartStore';
import { formatNairaWhole } from '@/features/food/utils';
import type { Restaurant } from '@/features/food/types';

// ── Landing-screen config ───────────────────────────────────────────────────
//
// This screen is the module's only nav entry (src/constants/modules.ts). It used
// to render a hard-coded RESTAURANTS array whose ids ('1','2',…) matched nothing
// real, and every card pushed a bare '/food' — so the tapped restaurant was
// silently discarded and you always landed on the generic list. It now reads the
// same live paged query the /food discovery screen uses, so the
// cards are real and deep-link to the right store.

const CUISINE_FILTERS = [
  { key: 'all',     label: 'All' },
  { key: 'local',   label: 'Local' },
  { key: 'fast',    label: 'Fast Food' },
  { key: 'chinese', label: 'Chinese' },
  { key: 'grills',  label: 'Grills' },
  { key: 'healthy', label: 'Healthy' },
] as const;
type Cuisine = typeof CUISINE_FILTERS[number]['key'];

// Browse tiles. Each one opens the real (data-backed) Food module rather than
// filtering the mock list below — `href` is what makes them tappable; without it
// they were inert decoration. Nearby/Popular/Offers map to ?view= handled in
// app/food/index.tsx. There is no scheduled-ordering feature yet, so that slot
// is My Orders until pre-ordering ships.
const CATEGORIES = [
  { id: 'nearby',    label: 'Nearby',     icon: 'MapPin',      accent: Colors.secondary,  bg: Colors.iconBgBlue,          href: '/food?view=nearby' },
  { id: 'popular',   label: 'Popular',    icon: 'Flame',       accent: '#EF4444',         bg: 'rgba(239,68,68,0.08)',     href: '/food?view=popular' },
  { id: 'offers',    label: 'Offers',     icon: 'Tag',         accent: '#16A34A',         bg: Colors.iconBgGreen,         href: '/food?view=offers' },
  { id: 'orders',    label: 'My Orders',  icon: 'ReceiptText', accent: Colors.primary,    bg: Colors.iconBgPurple,        href: '/food/orders' },
] as const;

// The restaurant list is fetched live and PAGED via useRestaurantSearch() in the component
// below. The former hard-coded RESTAURANTS array lived here.

// ── Sub-components ──────────────────────────────────────────────────────────

function DynamicIcon({ name, size = 22, color }: { name: string; size?: number; color: string }) {
  const IC = (Icons as unknown as Record<string, Icons.LucideIcon>)[name] ?? Icons.Utensils;
  return <IC size={size} color={color} strokeWidth={1.8} />;
}

function StarRow({ rating }: { rating: number }) {
  return (
    <View style={sr.row}>
      <Icons.Star size={12} color={Colors.gold} fill={Colors.gold} strokeWidth={0} />
      <Text style={sr.label}>{rating.toFixed(1)}</Text>
    </View>
  );
}

const sr = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', gap: 3 },
  label: { ...Typography.labelSm, color: Colors.onSurface },
});

function RestaurantCard({
  item,
  onPress,
  matchedDish,
}: {
  item: Restaurant;
  onPress: () => void;
  /** Set when this card only matched the search via a menu item, not the
   *  restaurant's name/tags — shown so it's clear why the result appeared. */
  matchedDish?: string | null;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [rc.card, shadow1, pressed && { opacity: 0.88 }]}
      accessibilityRole="button"
    >
      <View style={[rc.iconBox, { backgroundColor: item.iconBg }]}>
        <DynamicIcon name={item.icon} color={item.iconColor} size={26} />
      </View>

      <View style={rc.body}>
        <View style={rc.nameRow}>
          <Text style={rc.name} numberOfLines={1}>{item.name}</Text>
          {item.promo && (
            <View style={rc.promoBadge}>
              <Text style={rc.promoText}>{item.promo}</Text>
            </View>
          )}
        </View>

        {matchedDish ? (
          <View style={rc.matchRow}>
            <Icons.Search size={11} color={Colors.secondary} strokeWidth={2} />
            <Text style={rc.matchText}>Has "{matchedDish}"</Text>
          </View>
        ) : (
          <View style={rc.metaRow}>
            {item.tags.map((t) => (
              <Text key={t} style={rc.tag}>{t}</Text>
            ))}
          </View>
        )}

        <View style={rc.bottomRow}>
          <StarRow rating={item.rating} />
          <Text style={rc.dot}>·</Text>
          <Icons.Clock size={11} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={rc.meta}>{item.etaLabel}</Text>
          <Text style={rc.dot}>·</Text>
          <Text style={rc.meta}>Min {formatNairaWhole(item.minOrderKobo)}</Text>
          {!item.isOpen && (
            <>
              <Text style={rc.dot}>·</Text>
              <Text style={rc.closed}>Closed</Text>
            </>
          )}
        </View>
      </View>

      <Icons.ChevronRight size={16} color={Colors.outline} strokeWidth={2} />
    </Pressable>
  );
}

const rc = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  iconBox: {
    width: 54,
    height: 54,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  body:     { flex: 1, gap: 4 },
  nameRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  name:     { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  promoBadge: {
    backgroundColor: Colors.iconBgGreen,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.sm,
  },
  promoText: { ...Typography.labelSm, color: '#16A34A' },
  metaRow:  { flexDirection: 'row', gap: 6 },
  tag:      { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  matchText: { ...Typography.labelSm, color: Colors.secondary },
  bottomRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  dot:      { ...Typography.labelSm, color: Colors.outline },
  meta:     { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  closed:   { ...Typography.labelSm, color: Colors.error },
});

/**
 * The merchant's way in.
 *
 * The owner console (create store, menu, hours, earnings, staff) has existed at
 * /food/restaurant/* the whole time, but nothing in the Food module linked to
 * it — you had to already know the route. So every screen here was
 * customer-only, and a restaurateur had no path from "I want to sell" to the
 * create-store form.
 *
 * One card, two states, driven by whether the signed-in user already owns a
 * store: create, or jump straight into managing what they run. While the lookup
 * is in flight the card renders nothing rather than flashing the wrong label at
 * an owner.
 */
function MerchantEntryCard() {
  const { data: stores, isLoading } = useMyStores();
  if (isLoading) return null;

  const owned = stores ?? [];
  const hasStore = owned.length > 0;
  const subtitle = hasStore
    ? owned.length === 1
      ? owned[0].name
      : `${owned.length} outlets`
    : 'Create your store and start receiving orders';

  return (
    <Pressable
      onPress={() => router.push(hasStore ? '/food/restaurant' : '/food/restaurant/manage')}
      style={({ pressed }) => [s.merchantCard, shadow1, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityLabel={hasStore ? 'Open your restaurant dashboard' : 'Create your restaurant'}
    >
      <View style={s.merchantIcon}>
        <Icons.Store size={20} color={Colors.primary} strokeWidth={2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.merchantTitle}>{hasStore ? 'Your restaurant' : 'Sell on Paymax Food'}</Text>
        <Text style={s.merchantSubtitle} numberOfLines={1}>{subtitle}</Text>
      </View>
      <Icons.ChevronRight size={16} color={Colors.outline} strokeWidth={2} />
    </Pressable>
  );
}

// ── Main screen ─────────────────────────────────────────────────────────────

export default function FoodScreen() {
  const [cuisine, setCuisine] = useState<Cuisine>('all');
  const [search, setSearch]   = useState('');

  const packages = useCartStore((st) => st.packages);
  const cartCount = cartItemCount(packages);

  const query = search.trim();
  const debouncedQuery = useDebouncedValue(query);

  // Search and the cuisine chips are SERVER params now. They used to run over an
  // in-memory copy of every open restaurant — 2,016 rows, one card each, which
  // is what made this screen cost ~48k DOM nodes to render. Filtering only the
  // rows already downloaded was never an option: a search would then match
  // whichever page happened to have loaded.
  //
  // Still name/description/cuisine, not dishes. Dish-level search exists in
  // backend/internal/restaurant/search.go but is not yet routed; when it is,
  // this call is the place it lands.
  const {
    items: filtered,
    total,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useRestaurantSearch({ q: debouncedQuery, cuisine: cuisine === 'all' ? '' : cuisine });

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Top bar */}
      <View style={s.topBar}>
        <Pressable onPress={() => goBack('/services')} style={s.iconButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icons.ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={s.topTitle}>Food & Delivery</Text>
        {/* Was pushing '/food' (the discovery list), not the cart. */}
        <Pressable
          style={s.iconButton}
          onPress={() => router.push('/food/checkout')}
          accessibilityRole="button"
          accessibilityLabel={cartCount ? `View cart, ${cartCount} items` : 'View cart'}
        >
          <Icons.ShoppingCart size={21} color={Colors.primary} strokeWidth={2} />
          {cartCount > 0 && (
            <View style={s.cartBadge}>
              <Text style={s.cartBadgeText}>{cartCount > 9 ? '9+' : cartCount}</Text>
            </View>
          )}
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        {/* Hero — primary entry into the full Food & Delivery experience */}
        <Pressable
          onPress={() => router.push('/food')}
          style={({ pressed }) => pressed && { opacity: 0.92 }}
          accessibilityRole="button"
          accessibilityLabel="Open Food & Delivery"
        >
          <LinearGradient
            colors={['#EF4444', '#B91C1C']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[s.hero, shadow2]}
          >
            <Text style={s.heroEyebrow}>Paymax Food</Text>
            <Text style={s.heroTitle}>Hungry? Order now</Text>
            <Text style={s.heroSubtitle}>Restaurants near you, live-tracked delivery, chat with your rider — pay with your Paymax wallet.</Text>
            <View style={s.heroCta}>
              <Text style={s.heroCtaText}>Browse restaurants</Text>
              <Icons.ArrowRight size={16} color={Colors.white} strokeWidth={2.4} />
            </View>
          </LinearGradient>
        </Pressable>

        {/* Search */}
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search restaurant or dish…"
        />

        {/* Quick category grid */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Browse</Text>
        </View>

        <View style={s.catGrid}>
          {CATEGORIES.map((cat) => (
            <Pressable
              key={cat.id}
              onPress={() => router.push(cat.href)}
              style={({ pressed }) => [s.catCard, shadow1, pressed && { opacity: 0.82 }]}
              accessibilityRole="button"
              accessibilityLabel={cat.label}
            >
              <View style={[s.catIcon, { backgroundColor: cat.bg }]}>
                <DynamicIcon name={cat.icon} color={cat.accent} size={20} />
              </View>
              <Text style={s.catLabel}>{cat.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Merchant entry point — see MerchantEntryCard. */}
        <MerchantEntryCard />

        {/* Cuisine filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.chips}
          contentContainerStyle={s.chipsContent}
        >
          {CUISINE_FILTERS.map((f) => (
            <Pressable
              key={f.key}
              onPress={() => setCuisine(f.key)}
              style={[s.chip, cuisine === f.key && s.chipActive]}
            >
              <Text style={[s.chipLabel, cuisine === f.key && s.chipLabelActive]}>{f.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Restaurant list */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>
            {cuisine === 'all' ? 'All Restaurants' : CUISINE_FILTERS.find((f) => f.key === cuisine)?.label}
          </Text>
          <Text style={s.sectionMeta}>
            {isLoading
              ? '…'
              : filtered.length < total
                ? `${filtered.length} of ${total.toLocaleString('en-NG')}`
                : `${total.toLocaleString('en-NG')} open`}
          </Text>
        </View>

        <View style={s.list}>
          {isLoading ? (
            <Text style={s.empty}>Loading restaurants…</Text>
          ) : isError ? (
            <View style={s.errorBox}>
              <Text style={s.empty}>Couldn't load restaurants.</Text>
              <Pressable onPress={() => void refetch()} accessibilityRole="button">
                <Text style={s.retry}>Tap to retry</Text>
              </Pressable>
            </View>
          ) : filtered.length === 0 ? (
            <Text style={s.empty}>
              {debouncedQuery ? `No restaurants match "${debouncedQuery}"` : 'No restaurants available yet.'}
            </Text>
          ) : (
            <>
              {filtered.map((item) => (
                <RestaurantCard
                  key={item.id}
                  item={item}
                  // Deep-link to the tapped store. The old handler pushed a bare
                  // '/food', throwing the id away.
                  onPress={() => router.push(`/food/restaurant/${item.id}`)}
                />
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
                    {isFetchingNextPage
                      ? 'Loading…'
                      : `Load more (${(total - filtered.length).toLocaleString('en-NG')} left)`}
                  </Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      </ScrollView>
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
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerLow,
  },
  cartBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartBadgeText: { ...Typography.labelSm, color: Colors.white },
  topTitle: { ...Typography.titleLg, color: Colors.primary },
  content: {
    paddingTop: Spacing.lg,
    paddingBottom: Platform.OS === 'ios' ? 120 : 96,
  },
  hero: {
    minHeight: 172,
    borderRadius: Radius.xl,
    padding: Spacing.cardPadding,
    justifyContent: 'flex-end',
    marginHorizontal: Spacing.containerMargin,
    marginBottom: Spacing.lg,
  },
  heroEyebrow:  { ...Typography.labelSm, color: 'rgba(255,255,255,0.85)' },
  heroTitle:    { ...Typography.headlineLgMobile, color: Colors.white, marginTop: Spacing.xs },
  heroSubtitle: { ...Typography.bodySm, color: 'rgba(255,255,255,0.85)', marginTop: Spacing.xs },
  heroCta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.md },
  heroCtaText: { ...Typography.labelMd, color: Colors.white },
  sectionHeader: {
    paddingHorizontal: Spacing.containerMargin,
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: { ...Typography.titleLg, color: Colors.onSurface },
  sectionMeta:  { ...Typography.labelMd, color: Colors.secondary },
  catGrid: {
    paddingHorizontal: Spacing.containerMargin,
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  catCard: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    paddingVertical: Spacing.md,
    gap: 6,
  },
  catIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catLabel: { ...Typography.labelSm, color: Colors.onSurface, textAlign: 'center' },
  chips: { flexGrow: 0, marginTop: Spacing.lg },
  chipsContent: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  chipActive:      { backgroundColor: '#EF4444', borderColor: '#EF4444' },
  chipLabel:       { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipLabelActive: { color: Colors.white },
  list:  { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  loadMore: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLowest,
    marginBottom: Spacing.md,
  },
  loadMoreLabel: { ...Typography.labelMd, color: Colors.primary },
  merchantCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginHorizontal: Spacing.containerMargin,
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  merchantIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.iconBgPurple,
  },
  merchantTitle: { ...Typography.labelLg, color: Colors.onSurface },
  merchantSubtitle: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  empty: { ...Typography.bodyMd, color: Colors.outline, textAlign: 'center', marginTop: Spacing.xxl },
  errorBox: { alignItems: 'center', gap: Spacing.sm },
  retry: { ...Typography.labelLg, color: Colors.primary },
});
