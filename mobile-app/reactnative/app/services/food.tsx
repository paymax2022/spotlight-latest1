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
import { LinearGradient } from 'expo-linear-gradient';
import * as Icons from 'lucide-react-native';
import SearchBar from '@/components/SearchBar';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1, shadow2 } from '@/constants/shadows';

// ── Static mock data ────────────────────────────────────────────────────────

const CUISINE_FILTERS = [
  { key: 'all',     label: 'All' },
  { key: 'local',   label: 'Local' },
  { key: 'fast',    label: 'Fast Food' },
  { key: 'chinese', label: 'Chinese' },
  { key: 'grills',  label: 'Grills' },
  { key: 'healthy', label: 'Healthy' },
] as const;
type Cuisine = typeof CUISINE_FILTERS[number]['key'];

const CATEGORIES = [
  { id: 'nearby',    label: 'Nearby',        icon: 'MapPin',         accent: Colors.secondary,  bg: Colors.iconBgBlue },
  { id: 'popular',   label: 'Popular',        icon: 'Flame',          accent: '#EF4444',         bg: 'rgba(239,68,68,0.08)' },
  { id: 'offers',    label: 'Offers',         icon: 'Tag',            accent: '#16A34A',         bg: Colors.iconBgGreen },
  { id: 'schedule',  label: 'Schedule',       icon: 'Clock',          accent: Colors.primary,    bg: Colors.iconBgPurple },
];

const RESTAURANTS = [
  {
    id: '1',
    name: 'Mama Cass',
    cuisine: 'local',
    tags: ['Local', 'Soups'],
    // Real dish names from this restaurant's menu (src/features/food/mock.ts,
    // MENU_BY_RESTAURANT.r1) so dish search here matches what's actually orderable.
    menuItems: ['Egusi Soup', 'Afang Soup', 'Ogbono Soup', 'Jollof Rice', 'Fried Rice', 'Pounded Yam'],
    rating: 4.8,
    time: '20–30 min',
    minOrder: '₦2,500',
    promo: '10% off',
    icon: 'UtensilsCrossed',
    iconColor: '#EF4444',
    bg: 'rgba(239,68,68,0.08)',
  },
  {
    id: '2',
    name: 'Chicken Republic',
    cuisine: 'fast',
    tags: ['Fast Food', 'Chicken'],
    menuItems: ['Fried Chicken', 'Chicken Burger', 'Chicken Wrap', 'Chips', 'Meat Pie'],
    rating: 4.5,
    time: '15–25 min',
    minOrder: '₦1,500',
    promo: null,
    icon: 'Drumstick',
    iconColor: '#F97316',
    bg: 'rgba(249,115,22,0.08)',
  },
  {
    id: '3',
    name: 'Dragon Palace',
    cuisine: 'chinese',
    tags: ['Chinese', 'Rice'],
    menuItems: ['Fried Rice', 'Sweet & Sour Chicken', 'Spring Rolls', 'Beef Noodles', 'Chow Mein'],
    rating: 4.6,
    time: '25–40 min',
    minOrder: '₦3,000',
    promo: 'Free delivery',
    icon: 'Soup',
    iconColor: Colors.teal,
    bg: Colors.iconBgTeal,
  },
  {
    id: '4',
    name: 'The Grill House',
    cuisine: 'grills',
    tags: ['Grills', 'BBQ'],
    menuItems: ['Suya', 'Grilled Chicken', 'BBQ Ribs', 'Grilled Fish', 'Peppered Steak'],
    rating: 4.7,
    time: '30–45 min',
    minOrder: '₦4,000',
    promo: null,
    icon: 'Flame',
    iconColor: '#EAB308',
    bg: 'rgba(234,179,8,0.10)',
  },
  {
    id: '5',
    name: 'Green Bowl',
    cuisine: 'healthy',
    tags: ['Healthy', 'Salads'],
    menuItems: ['Caesar Salad', 'Grilled Chicken Salad', 'Smoothie Bowl', 'Quinoa Bowl', 'Avocado Toast'],
    rating: 4.9,
    time: '20–30 min',
    minOrder: '₦2,000',
    promo: '15% off',
    icon: 'Salad',
    iconColor: '#16A34A',
    bg: Colors.iconBgGreen,
  },
  {
    id: '6',
    name: 'Street Buka',
    cuisine: 'local',
    tags: ['Local', 'Pepper Soup'],
    menuItems: ['Pepper Soup', 'Amala', 'Ewedu', 'Gbegiri', 'Moin Moin'],
    rating: 4.4,
    time: '15–25 min',
    minOrder: '₦1,000',
    promo: null,
    icon: 'Bowl',
    iconColor: Colors.primary,
    bg: Colors.iconBgPurple,
  },
];

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
  item: typeof RESTAURANTS[0];
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
      <View style={[rc.iconBox, { backgroundColor: item.bg }]}>
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
          <Text style={rc.meta}>{item.time}</Text>
          <Text style={rc.dot}>·</Text>
          <Text style={rc.meta}>Min {item.minOrder}</Text>
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
});

// ── Main screen ─────────────────────────────────────────────────────────────

export default function FoodScreen() {
  const [cuisine, setCuisine] = useState<Cuisine>('all');
  const [search, setSearch]   = useState('');

  const query = search.trim().toLowerCase();

  // A restaurant matches if the query hits its name/tags OR any dish on its
  // menu — the search bar previously only checked name+tags, so searching
  // e.g. "jollof" or "suya" found nothing even though those dishes exist.
  // matchedDish (when the hit came from the menu, not the name/tags) is
  // surfaced on the card so it's clear *why* a result showed up.
  const filtered = RESTAURANTS.map((r) => {
    const matchesCuisine = cuisine === 'all' || r.cuisine === cuisine;
    if (!query) return matchesCuisine ? { ...r, matchedDish: null } : null;

    const matchesName = r.name.toLowerCase().includes(query);
    const matchesTag  = r.tags.some((t) => t.toLowerCase().includes(query));
    const matchedDish = r.menuItems.find((item) => item.toLowerCase().includes(query)) ?? null;

    if (!matchesCuisine || !(matchesName || matchesTag || matchedDish)) return null;
    return { ...r, matchedDish: matchesName || matchesTag ? null : matchedDish };
  }).filter((r): r is (typeof RESTAURANTS)[number] & { matchedDish: string | null } => r !== null);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Top bar */}
      <View style={s.topBar}>
        <Pressable onPress={() => router.back()} style={s.iconButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icons.ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={s.topTitle}>Food & Delivery</Text>
        <Pressable style={s.iconButton} onPress={() => router.push('/food')} accessibilityRole="button" accessibilityLabel="View cart">
          <Icons.ShoppingCart size={21} color={Colors.primary} strokeWidth={2} />
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
              style={({ pressed }) => [s.catCard, shadow1, pressed && { opacity: 0.82 }]}
              accessibilityRole="button"
            >
              <View style={[s.catIcon, { backgroundColor: cat.bg }]}>
                <DynamicIcon name={cat.icon} color={cat.accent} size={20} />
              </View>
              <Text style={s.catLabel}>{cat.label}</Text>
            </Pressable>
          ))}
        </View>

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
          <Text style={s.sectionMeta}>{filtered.length} open</Text>
        </View>

        <View style={s.list}>
          {filtered.length === 0 ? (
            <Text style={s.empty}>No restaurants match "{search}"</Text>
          ) : (
            filtered.map((item) => (
              <RestaurantCard
                key={item.id}
                item={item}
                matchedDish={item.matchedDish}
                onPress={() => router.push('/food')}
              />
            ))
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
  empty: { ...Typography.bodyMd, color: Colors.outline, textAlign: 'center', marginTop: Spacing.xxl },
});
