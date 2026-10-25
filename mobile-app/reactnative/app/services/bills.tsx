import React, { useMemo, useState } from 'react';
import { View, Text, Image, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import * as Icons from 'lucide-react-native';
import SearchBar from '@/components/SearchBar';
import { BILL_CATEGORIES, PAYMENT_SERVICES, type PaymentServiceId } from '@/data/billPayment';
import { useBillerStore, type SavedBiller } from '@/features/services/billerStore';
import { Colors } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import { HomeMenuButton } from '@/components/HomeMenu';
import { RemoteBanner } from '@/features/media/banners';

const HERO_BANNER_URL = 'https://res.cloudinary.com/paymax/image/upload/v1792925219/Utility_payments_made_easy_omlar0.png';

// Short labels match the utility tab bar (ModuleTabBar / UTILITY_TABS) so the
// same service reads the same everywhere in the module.
const TILE_LABELS: Record<string, string> = {
  airtime: 'Airtime',
  data: 'Data',
  electricity: 'Power',
  'cable-tv': 'TV',
  education: 'Exams',
};

interface ServiceTile {
  id: string;
  label: string;
  icon: string;
  route: string;
  accent: string;
  bg: string;
}

// Five payment services plus the three account shortcuts, so the grid fills
// two full rows of four.
const SERVICE_TILES: ServiceTile[] = [
  ...BILL_CATEGORIES.map((c) => ({
    id: c.id,
    label: TILE_LABELS[c.id] ?? c.label,
    icon: c.icon,
    route: c.route,
    accent: c.accent,
    bg: c.bg,
  })),
  { id: 'saved', label: 'Saved', icon: 'UsersRound', route: '/services/beneficiaries', accent: Colors.teal, bg: Colors.iconBgTeal },
  { id: 'history', label: 'History', icon: 'History', route: '/services/transactions', accent: Colors.secondary, bg: Colors.iconBgBlue },
  { id: 'support', label: 'Support', icon: 'LifeBuoy', route: '/services/support', accent: Colors.primary, bg: Colors.iconBgPurple },
];

// A saved biller carries no route of its own, so its service flow is found from
// the icon it was saved with (Smartphone → airtime, Zap → electricity, …).
const routeForBiller = (biller: SavedBiller): string | undefined =>
  BILL_CATEGORIES.find((c) => c.icon === biller.icon)?.route;

// What a tile answers to in search: its short and full labels, the words people
// actually type for it, and the providers behind it (so "mtn" finds Airtime and
// Data, "dstv" finds TV).
const TILE_ALIASES: Record<string, string[]> = {
  airtime: ['recharge', 'top up', 'credit', 'phone'],
  data: ['internet', 'bundle', 'wifi', 'mb', 'gb'],
  electricity: ['power', 'light', 'nepa', 'meter', 'prepaid', 'postpaid', 'token'],
  'cable-tv': ['television', 'decoder', 'subscription', 'cable'],
  education: ['exam', 'result', 'pin', 'scratch card', 'school', 'fees'],
  saved: ['beneficiaries', 'beneficiary', 'favourites', 'favorites'],
  history: ['transactions', 'receipts', 'past payments'],
  support: ['help', 'dispute', 'complaint', 'contact'],
};

const searchTermsFor = (tile: ServiceTile): string => {
  const category = BILL_CATEGORIES.find((c) => c.id === tile.id);
  const providers = (PAYMENT_SERVICES[tile.id as PaymentServiceId]?.providers ?? []).map((p) => p.name);
  return [tile.label, category?.label ?? '', ...(TILE_ALIASES[tile.id] ?? []), ...providers]
    .join(' ')
    .toLowerCase();
};

const SEARCHABLE_TILES = SERVICE_TILES.map((tile) => ({ tile, terms: searchTermsFor(tile) }));

const normalise = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function DynamicIcon({ name, size = 24, color }: { name: string; size?: number; color: string }) {
  const IconComponent = (Icons as unknown as Record<string, Icons.LucideIcon>)[name] ?? Icons.Circle;
  return <IconComponent size={size} color={color} strokeWidth={2} />;
}

export default function BillsScreen() {
  const recentBillers = useBillerStore((s) => s.billers);
  const [query, setQuery] = useState('');
  const q = normalise(query);

  const visibleTiles = useMemo(
    () => (q ? SEARCHABLE_TILES.filter(({ terms }) => terms.includes(q)).map(({ tile }) => tile) : SERVICE_TILES),
    [q],
  );
  const visibleBillers = useMemo(
    () => (q
      ? recentBillers.filter((b) => normalise(`${b.title} ${b.subtitle} ${b.amount ?? ''}`).includes(q))
      : recentBillers),
    [q, recentBillers],
  );
  const nothingFound = q.length > 0 && visibleTiles.length === 0 && visibleBillers.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => goBack('/services')} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icons.ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.topTitle}>Bill Payments</Text>
        <View style={styles.topActions}>
          <Pressable onPress={() => router.push('/services/transactions' as never)} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Transaction history">
            <Icons.History size={21} color={Colors.primary} strokeWidth={2} />
          </Pressable>
          <HomeMenuButton />
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <RemoteBanner slug="utility-bills" priority style={styles.banner} />

        {/* The "Paymax Bills Hub" text hero is gone. What remains is the banner picture
            alone, with nothing painted over it. */}
        <View style={styles.heroBanner}>
          <Image
            source={{ uri: HERO_BANNER_URL }}
            style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]}
            resizeMode="cover"
            accessibilityLabel="All your bills, one easy app. Airtime, data, electricity and cable TV."
          />
        </View>

        <SearchBar placeholder="Search biller or service" value={query} onChangeText={setQuery} />

        {nothingFound && (
          <View style={styles.empty} accessibilityRole="text" accessibilityLiveRegion="polite">
            <Icons.SearchX size={28} color={Colors.outline} strokeWidth={1.8} />
            <Text style={styles.emptyTitle}>No match for “{query.trim()}”</Text>
            <Text style={styles.emptyBody}>Try a service (airtime, power, TV) or a provider (MTN, DSTV, EKEDC).</Text>
          </View>
        )}

        {visibleBillers.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Quick pay</Text>
              <Pressable onPress={() => router.push('/services/beneficiaries' as never)} accessibilityRole="link">
                <Text style={styles.sectionAction}>Manage</Text>
              </Pressable>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickRow}
            >
              {visibleBillers.map((biller) => {
                const route = routeForBiller(biller);
                return (
                  <Pressable
                    key={biller.id}
                    disabled={!route}
                    onPress={() => route && router.push(route as never)}
                    accessibilityRole="button"
                    accessibilityLabel={`Pay ${biller.title}, ${biller.subtitle}`}
                    style={({ pressed }) => [styles.quickCard, shadow1, pressed && styles.pressed]}
                  >
                    <View style={[styles.quickIcon, { backgroundColor: biller.bg }]}>
                      <DynamicIcon name={biller.icon} color={biller.accent} size={20} />
                    </View>
                    <Text style={styles.quickTitle} numberOfLines={1}>{biller.title}</Text>
                    <Text style={styles.quickSubtitle} numberOfLines={1}>{biller.subtitle}</Text>
                    <View style={styles.quickFooter}>
                      <Text style={styles.quickAmount} numberOfLines={1}>{biller.amount ?? 'Pay again'}</Text>
                      <Icons.ChevronRight size={16} color={Colors.outline} strokeWidth={2} />
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        )}

        {visibleTiles.length > 0 && (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{q ? 'Services' : 'All services'}</Text>
          </View>
        )}

        <View style={styles.grid}>
          {visibleTiles.map((tile) => (
            <Pressable
              key={tile.id}
              onPress={() => router.push(tile.route as never)}
              accessibilityRole="button"
              accessibilityLabel={tile.label}
              style={({ pressed }) => [styles.tile, shadow1, pressed && styles.pressed]}
            >
              <View style={[styles.tileIcon, { backgroundColor: tile.bg }]}>
                <DynamicIcon name={tile.icon} color={tile.accent} size={22} />
              </View>
              <Text style={styles.tileLabel} numberOfLines={1}>{tile.label}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    height: 64,
    paddingHorizontal: Spacing.containerMargin,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // Level 2 glass: white at 70% with a 20px backdrop blur on web (DESIGN-Mobile.md).
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceContainerHigh,
    ...Platform.select({
      web: { backdropFilter: 'blur(20px)' } as never,
      default: {},
    }),
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
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
  banner: { marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.md },
  empty: {
    marginHorizontal: Spacing.containerMargin,
    marginTop: Spacing.sm,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceContainerLow,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  emptyTitle: { ...Typography.labelLg, color: Colors.onSurface, textAlign: 'center' },
  emptyBody: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  heroBanner: {
    aspectRatio: 2,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    marginHorizontal: Spacing.containerMargin,
    marginBottom: Spacing.lg,
  },
  sectionHeader: {
    paddingHorizontal: Spacing.containerMargin,
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: { ...Typography.titleLg, color: Colors.onSurface },
  sectionAction: { ...Typography.labelMd, color: Colors.secondary },
  quickRow: {
    paddingHorizontal: Spacing.containerMargin,
    gap: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  quickCard: {
    width: 176,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    gap: Spacing.xs,
  },
  quickIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  quickTitle: { ...Typography.labelMd, color: Colors.onSurface },
  quickSubtitle: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  quickFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.xs },
  quickAmount: { ...Typography.labelMd, color: Colors.primary, flexShrink: 1 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: Spacing.md,
    paddingHorizontal: Spacing.containerMargin,
  },
  tile: {
    width: '23%',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xs,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    gap: Spacing.sm,
  },
  tileIcon: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { ...Typography.labelSm, color: Colors.onSurface, textAlign: 'center' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
