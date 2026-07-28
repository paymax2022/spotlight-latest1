import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Icons from 'lucide-react-native';
import SearchBar from '@/components/SearchBar';
import StateView from '@/components/StateView';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1, shadow2 } from '@/constants/shadows';
import { useRestaurants } from '@/features/food/hooks';
import { useCartStore, cartItemCount } from '@/features/food/cartStore';
import { formatNairaWhole } from '@/features/food/utils';
import { DynamicIcon } from '@/features/food/components';
import type { Restaurant } from '@/features/food/types';

const CUISINE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'local', label: 'Local' },
  { key: 'fast', label: 'Fast Food' },
  { key: 'chinese', label: 'Chinese' },
  { key: 'grills', label: 'Grills' },
  { key: 'healthy', label: 'Healthy' },
] as const;
type Cuisine = (typeof CUISINE_FILTERS)[number]['key'];

function StarRow({ rating }: { rating: number }) {
  return (
    <View style={sr.row}>
      <Icons.Star size={12} color={Colors.gold} fill={Colors.gold} strokeWidth={0} />
      <Text style={sr.label}>{rating.toFixed(1)}</Text>
    </View>
  );
}
const sr = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  label: { ...Typography.labelSm, color: Colors.onSurface },
});

function RestaurantCard({ item, onPress }: { item: Restaurant; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!item.isOpen}
      style={({ pressed }) => [rc.card, shadow1, pressed && { opacity: 0.88 }, !item.isOpen && { opacity: 0.6 }]}
      accessibilityRole="button"
    >
      <View style={[rc.iconBox, { backgroundColor: item.iconBg }]}>
        <DynamicIcon name={item.icon} color={item.iconColor} size={26} />
      </View>
      <View style={rc.body}>
        <View style={rc.nameRow}>
          <Text style={rc.name} numberOfLines={1}>
            {item.name}
          </Text>
          {item.promo ? (
            <View style={rc.promoBadge}>
              <Text style={rc.promoText}>{item.promo}</Text>
            </View>
          ) : null}
        </View>
        <View style={rc.metaRow}>
          {item.tags.map((t) => (
            <Text key={t} style={rc.tag}>
              {t}
            </Text>
          ))}
        </View>
        <View style={rc.bottomRow}>
          <StarRow rating={item.rating} />
          <Text style={rc.dot}>·</Text>
          <Icons.Clock size={11} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={rc.meta}>{item.etaLabel}</Text>
          <Text style={rc.dot}>·</Text>
          <Text style={rc.meta}>Min {formatNairaWhole(item.minOrderKobo)}</Text>
          {!item.isOpen ? <Text style={rc.closed}>Closed</Text> : null}
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
  iconBox: { width: 54, height: 54, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  name: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  promoBadge: { backgroundColor: Colors.iconBgGreen, paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.sm },
  promoText: { ...Typography.labelSm, color: '#16A34A' },
  metaRow: { flexDirection: 'row', gap: 6 },
  tag: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  bottomRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  dot: { ...Typography.labelSm, color: Colors.outline },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  closed: { ...Typography.labelSm, color: Colors.error, marginLeft: 4 },
});

export default function FoodDiscoveryScreen() {
  const [cuisine, setCuisine] = useState<Cuisine>('all');
  const [search, setSearch] = useState('');
  const { data, isLoading, isError, refetch } = useRestaurants();
  const cartPackages = useCartStore((s) => s.packages);
  const cartCount = cartItemCount(cartPackages);

  const filtered = useMemo(() => {
    const list = data ?? [];
    return list.filter((r) => {
      const matchesCuisine = cuisine === 'all' || r.cuisine === cuisine;
      const q = search.toLowerCase();
      const matchesSearch =
        !search || r.name.toLowerCase().includes(q) || r.tags.some((t) => t.toLowerCase().includes(q));
      return matchesCuisine && matchesSearch;
    });
  }, [data, cuisine, search]);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.topBar}>
        <Pressable onPress={() => router.back()} style={s.iconButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icons.ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={s.topTitle}>Food & Delivery</Text>
        <Pressable
          style={s.iconButton}
          onPress={() => router.push('/food/orders')}
          accessibilityRole="button"
          accessibilityLabel="My orders"
        >
          <Icons.ReceiptText size={21} color={Colors.primary} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        <LinearGradient colors={['#EF4444', '#B91C1C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.hero, shadow2]}>
          <Text style={s.heroEyebrow}>Paymax Food</Text>
          <Text style={s.heroTitle}>Hungry? Order now</Text>
          <Text style={s.heroSubtitle}>Restaurants near you, live tracked delivery, chat with your rider — pay with your Paymax wallet.</Text>
        </LinearGradient>

        <SearchBar value={search} onChangeText={setSearch} placeholder="Search restaurant or dish…" />

        {/* Role entry points (rider / restaurant) */}
        <View style={s.roleRow}>
          <Pressable style={({ pressed }) => [s.roleCard, shadow1, pressed && { opacity: 0.85 }]} onPress={() => router.push('/food/rider')}>
            <Icons.Bike size={18} color={Colors.secondary} strokeWidth={2} />
            <Text style={s.roleLabel}>I'm a rider</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [s.roleCard, shadow1, pressed && { opacity: 0.85 }]} onPress={() => router.push('/food/restaurant')}>
            <Icons.Store size={18} color={Colors.secondary} strokeWidth={2} />
            <Text style={s.roleLabel}>Restaurant queue</Text>
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips} contentContainerStyle={s.chipsContent}>
          {CUISINE_FILTERS.map((f) => (
            <Pressable key={f.key} onPress={() => setCuisine(f.key)} style={[s.chip, cuisine === f.key && s.chipActive]}>
              <Text style={[s.chipLabel, cuisine === f.key && s.chipLabelActive]}>{f.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>{cuisine === 'all' ? 'All Restaurants' : CUISINE_FILTERS.find((f) => f.key === cuisine)?.label}</Text>
          {!isLoading && !isError ? <Text style={s.sectionMeta}>{filtered.filter((r) => r.isOpen).length} open</Text> : null}
        </View>

        <View style={s.list}>
          {isLoading ? (
            <StateView kind="loading" message="Finding restaurants near you…" />
          ) : isError ? (
            <StateView kind="error" title="Couldn't load restaurants" message="Check your connection and try again." actionLabel="Retry" onAction={() => refetch()} />
          ) : filtered.length === 0 ? (
            <StateView kind="empty" icon="SearchX" title="No restaurants found" message={search ? `Nothing matches "${search}".` : 'Try a different cuisine filter.'} />
          ) : (
            filtered.map((item) => (
              <RestaurantCard key={item.id} item={item} onPress={() => router.push(`/food/restaurant/${item.id}`)} />
            ))
          )}
        </View>
      </ScrollView>

      {/* Cart bar */}
      {cartCount > 0 ? (
        <Pressable style={[s.cartBar, shadow2]} onPress={() => router.push('/food/checkout')} accessibilityRole="button">
          <Icons.ShoppingCart size={18} color={Colors.white} strokeWidth={2} />
          <Text style={s.cartText}>{cartCount} item{cartCount > 1 ? 's' : ''} in cart</Text>
          <Text style={s.cartCta}>Checkout</Text>
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
  topTitle: { ...Typography.titleLg, color: Colors.primary },
  content: { paddingTop: Spacing.lg, paddingBottom: Platform.OS === 'ios' ? 140 : 120 },
  hero: { minHeight: 172, borderRadius: Radius.xl, padding: Spacing.cardPadding, justifyContent: 'flex-end', marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.lg },
  heroEyebrow: { ...Typography.labelSm, color: 'rgba(255,255,255,0.85)' },
  heroTitle: { ...Typography.headlineLgMobile, color: Colors.white, marginTop: Spacing.xs },
  heroSubtitle: { ...Typography.bodySm, color: 'rgba(255,255,255,0.85)', marginTop: Spacing.xs },
  roleRow: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.lg },
  roleCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    paddingVertical: Spacing.md,
  },
  roleLabel: { ...Typography.labelMd, color: Colors.onSurface },
  chips: { flexGrow: 0, marginTop: Spacing.lg },
  chipsContent: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.outlineVariant },
  chipActive: { backgroundColor: '#EF4444', borderColor: '#EF4444' },
  chipLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipLabelActive: { color: Colors.white },
  sectionHeader: { paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.lg, marginBottom: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { ...Typography.titleLg, color: Colors.onSurface },
  sectionMeta: { ...Typography.labelMd, color: Colors.secondary },
  list: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, minHeight: 200 },
  cartBar: {
    position: 'absolute',
    left: Spacing.containerMargin,
    right: Spacing.containerMargin,
    bottom: Platform.OS === 'ios' ? 32 : 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  cartText: { ...Typography.labelMd, color: Colors.white, flex: 1 },
  cartCta: { ...Typography.labelLg, color: Colors.white },
});
