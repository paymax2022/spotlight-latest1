// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listEvents } from '@/api/events.api';
import { AppLoader } from '@/components/ui/AppLoader';
import { colors } from '@/theme';
import { formatCurrency } from '@/utils/format';
import type { Event } from '@/types/fintech';

// ─── Design Tokens ───────────────────────────────────────────────────────────
const C = {
  primary: '#1a0042',
  primaryContainer: '#340075',
  secondary: '#0051d5',
  secondaryContainer: '#346cef',
  teal: '#48b8ac',
  gold: '#d4af37',
  bg: '#f8f9ff',
  surface: '#ffffff',
  surfaceContainer: '#eceef3',
  onSurface: '#191c20',
  onSurfaceMuted: '#4a4451',
  outline: '#ccc3d3',
};

const CATEGORIES = [
  { key: 'music', label: 'Music', icon: 'musical-notes-outline' },
  { key: 'tech', label: 'Tech', icon: 'hardware-chip-outline' },
  { key: 'nightlife', label: 'Nightlife', icon: 'moon-outline' },
  { key: 'business', label: 'Business', icon: 'briefcase-outline' },
];

// ─── Sub-components ──────────────────────────────────────────────────────────

function FeaturedHero({ event, onPress }: { event: Event; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.hero, pressed && { opacity: 0.95 }]} onPress={onPress}>
      {/* Gradient background */}
      <View style={styles.heroBg}>
        <View style={styles.heroGlow1} />
        <View style={styles.heroGlow2} />
      </View>
      <View style={styles.heroContent}>
        <View style={styles.heroTagRow}>
          <View style={styles.heroTag}>
            <View style={styles.heroTagDot} />
            <Text style={styles.heroTagText}>FEATURED</Text>
          </View>
          <Text style={styles.heroDate}>{new Date(event.date).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}</Text>
        </View>
        <Text style={styles.heroTitle} numberOfLines={2}>{event.title}</Text>
        <Text style={styles.heroDesc} numberOfLines={2}>{event.description}</Text>
        <View style={styles.heroFooter}>
          <View style={styles.heroMeta}>
            <Ionicons name="location-outline" size={13} color="rgba(255,255,255,0.7)" />
            <Text style={styles.heroMetaText} numberOfLines={1}>{event.venue}</Text>
          </View>
          <View style={styles.heroPrice}>
            <Text style={styles.heroPriceText}>
              {event.ticket_price_kobo === 0 ? 'FREE' : `From ${formatCurrency(event.ticket_price_kobo, 'NGN')}`}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function TrendingCard({ event, onPress }: { event: Event; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.trendCard, pressed && { opacity: 0.9 }]} onPress={onPress}>
      <View style={styles.trendImage}>
        <Ionicons name="musical-notes" size={28} color="rgba(255,255,255,0.3)" />
        <View style={styles.trendFavBtn}>
          <Ionicons name="heart-outline" size={15} color={C.onSurface} />
        </View>
      </View>
      <View style={styles.trendBody}>
        <Text style={styles.trendDate}>
          {new Date(event.date).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' }).toUpperCase()}
        </Text>
        <Text style={styles.trendTitle} numberOfLines={2}>{event.title}</Text>
        <Text style={styles.trendVenue} numberOfLines={1}>{event.venue}</Text>
        <Text style={styles.trendPrice}>
          {event.ticket_price_kobo === 0 ? 'FREE' : formatCurrency(event.ticket_price_kobo, 'NGN')}
        </Text>
      </View>
    </Pressable>
  );
}

function NearbyCard({ event, onPress }: { event: Event; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.nearbyCard, pressed && { opacity: 0.9 }]} onPress={onPress}>
      <View style={styles.nearbyImage}>
        <Ionicons name="calendar" size={22} color={C.secondary} />
      </View>
      <View style={styles.nearbyBody}>
        <Text style={styles.nearbyTitle} numberOfLines={1}>{event.title}</Text>
        <View style={styles.nearbyMeta}>
          <Ionicons name="time-outline" size={12} color={C.onSurfaceMuted} />
          <Text style={styles.nearbyMetaText}>{event.start_time} · {new Date(event.date).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}</Text>
        </View>
        <View style={styles.nearbyMeta}>
          <Ionicons name="location-outline" size={12} color={C.onSurfaceMuted} />
          <Text style={styles.nearbyMetaText} numberOfLines={1}>{event.venue}</Text>
        </View>
      </View>
      <View style={styles.nearbyRight}>
        {event.distance_km != null && (
          <Text style={styles.nearbyDist}>{event.distance_km.toFixed(1)}km</Text>
        )}
        <Text style={styles.nearbyPrice}>
          {event.ticket_price_kobo === 0 ? 'FREE' : formatCurrency(event.ticket_price_kobo, 'NGN')}
        </Text>
      </View>
    </Pressable>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function EventsDiscoveryScreen() {
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const eventsQuery = useQuery({
    queryKey: ['events-discovery', activeCategory, search],
    queryFn: () => listEvents({
      category: activeCategory ?? undefined,
      search: search || undefined,
      limit: 20,
    }),
  });

  const events = eventsQuery.data ?? [];
  const featured = events[0];
  const trending = events.slice(1, 4);
  const nearby = events.slice(4, 8);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color={C.onSurface} />
          </Pressable>
          <View>
            <View style={styles.locationRow}>
              <Ionicons name="location-sharp" size={13} color={C.secondary} />
              <Text style={styles.locationText}>Lagos, NG</Text>
            </View>
            <Text style={styles.headerTitle}>Paymax Events</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <Pressable
            style={styles.iconBtn}
            onPress={() => router.push('/events/my-tickets' as never)}
          >
            <Ionicons name="ticket-outline" size={22} color={C.onSurface} />
          </Pressable>
          <Pressable style={styles.iconBtn}>
            <Ionicons name="notifications-outline" size={22} color={C.onSurface} />
          </Pressable>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color={C.onSurfaceMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search events, artists, venues…"
            placeholderTextColor={C.onSurfaceMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={18} color={C.onSurfaceMuted} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Category Pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.catRow}
      >
        <Pressable
          style={[styles.catPill, activeCategory === null && styles.catPillActive]}
          onPress={() => setActiveCategory(null)}
        >
          <Text style={[styles.catPillText, activeCategory === null && styles.catPillTextActive]}>
            All
          </Text>
        </Pressable>
        {CATEGORIES.map((c) => (
          <Pressable
            key={c.key}
            style={[styles.catPill, activeCategory === c.key && styles.catPillActive]}
            onPress={() => setActiveCategory(activeCategory === c.key ? null : c.key)}
          >
            <Ionicons
              name={c.icon as never}
              size={14}
              color={activeCategory === c.key ? '#fff' : C.onSurfaceMuted}
            />
            <Text style={[styles.catPillText, activeCategory === c.key && styles.catPillTextActive]}>
              {c.label}
            </Text>
          </Pressable>
        ))}
        <Pressable style={styles.catPill}>
          <Text style={styles.catPillSeeAll}>See All</Text>
          <Ionicons name="chevron-forward" size={12} color={C.secondary} />
        </Pressable>
      </ScrollView>

      {/* Scrollable Body */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={eventsQuery.isRefetching}
            onRefresh={eventsQuery.refetch}
            tintColor={C.secondary}
          />
        }
      >
        {eventsQuery.isLoading ? (
          <AppLoader />
        ) : (
          <>
            {/* Featured Hero */}
            {featured && (
              <View style={styles.section}>
                <FeaturedHero
                  event={featured}
                  onPress={() => router.push(`/events/${featured.id}` as never)}
                />
              </View>
            )}

            {/* Trending Now */}
            {trending.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Trending Now</Text>
                  <Pressable>
                    <Text style={styles.seeAllLink}>See All</Text>
                  </Pressable>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.trendRow}
                >
                  {trending.map((e) => (
                    <TrendingCard
                      key={e.id}
                      event={e}
                      onPress={() => router.push(`/events/${e.id}` as never)}
                    />
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Events Near You */}
            {nearby.length > 0 && (
              <View style={[styles.section, { paddingBottom: 32 }]}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Events Near You</Text>
                  <Pressable style={styles.mapLink}>
                    <Ionicons name="map-outline" size={14} color={C.secondary} />
                    <Text style={styles.mapLinkText}>View Map</Text>
                  </Pressable>
                </View>
                <View style={styles.nearbyList}>
                  {nearby.map((e) => (
                    <NearbyCard
                      key={e.id}
                      event={e}
                      onPress={() => router.push(`/events/${e.id}` as never)}
                    />
                  ))}
                </View>
              </View>
            )}

            {/* Empty state */}
            {events.length === 0 && (
              <View style={styles.empty}>
                <Ionicons name="calendar-outline" size={56} color={C.outline} />
                <Text style={styles.emptyTitle}>No events found</Text>
                <Text style={styles.emptyText}>Try a different category or search term</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.outline,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.surfaceContainer,
    alignItems: 'center', justifyContent: 'center',
  },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 1 },
  locationText: { fontSize: 11, color: C.secondary, fontWeight: '600' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: C.onSurface },
  headerRight: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.surfaceContainer,
    alignItems: 'center', justifyContent: 'center',
  },

  // Search
  searchRow: { paddingHorizontal: 20, paddingVertical: 12, backgroundColor: C.surface },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#F1F5F9', borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  searchInput: { flex: 1, fontSize: 15, color: C.onSurface },

  // Categories
  catRow: { paddingHorizontal: 20, paddingVertical: 10, gap: 8 },
  catPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 9999,
    backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.outline,
  },
  catPillActive: { backgroundColor: C.primaryContainer, borderColor: C.primaryContainer },
  catPillText: { fontSize: 13, fontWeight: '600', color: C.onSurfaceMuted },
  catPillTextActive: { color: '#fff' },
  catPillSeeAll: { fontSize: 13, fontWeight: '600', color: C.secondary },

  // Section
  section: { paddingHorizontal: 20, marginTop: 20 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: C.onSurface },
  seeAllLink: { fontSize: 13, fontWeight: '600', color: C.secondary },
  mapLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  mapLinkText: { fontSize: 13, fontWeight: '600', color: C.secondary },

  // Hero / Featured
  hero: {
    borderRadius: 20, overflow: 'hidden',
    minHeight: 200,
    shadowColor: C.primaryContainer,
    shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.2, shadowRadius: 24, elevation: 8,
  },
  heroBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: C.primary, overflow: 'hidden',
  },
  heroGlow1: {
    position: 'absolute', top: -60, right: -60,
    width: 200, height: 200, borderRadius: 100,
    backgroundColor: C.secondary, opacity: 0.25,
  },
  heroGlow2: {
    position: 'absolute', bottom: -40, left: -40,
    width: 160, height: 160, borderRadius: 80,
    backgroundColor: C.teal, opacity: 0.2,
  },
  heroContent: { padding: 24, paddingTop: 24, paddingBottom: 24 },
  heroTagRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  heroTag: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 9999,
  },
  heroTagDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.teal },
  heroTagText: { fontSize: 11, fontWeight: '800', color: '#fff', letterSpacing: 1 },
  heroDate: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.7)' },
  heroTitle: { fontSize: 24, fontWeight: '800', color: '#fff', lineHeight: 32, marginBottom: 8 },
  heroDesc: { fontSize: 14, color: 'rgba(255,255,255,0.7)', lineHeight: 20, marginBottom: 18 },
  heroFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1 },
  heroMetaText: { fontSize: 13, color: 'rgba(255,255,255,0.7)', flex: 1 },
  heroPrice: {
    backgroundColor: C.gold + '25',
    borderWidth: 1, borderColor: C.gold + '60',
    borderRadius: 9999, paddingHorizontal: 12, paddingVertical: 5,
  },
  heroPriceText: { fontSize: 13, fontWeight: '700', color: C.gold },

  // Trending Carousel
  trendRow: { gap: 14, paddingRight: 20 },
  trendCard: {
    width: 180,
    backgroundColor: C.surface, borderRadius: 16, overflow: 'hidden',
    borderWidth: 1, borderColor: '#F1F5F9',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 12, elevation: 3,
  },
  trendImage: {
    height: 110, backgroundColor: C.primaryContainer + '20',
    alignItems: 'center', justifyContent: 'center', position: 'relative',
  },
  trendFavBtn: {
    position: 'absolute', top: 8, right: 8,
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center', justifyContent: 'center',
  },
  trendBody: { padding: 12, gap: 4 },
  trendDate: { fontSize: 10, fontWeight: '700', color: C.secondary, letterSpacing: 0.5 },
  trendTitle: { fontSize: 14, fontWeight: '700', color: C.onSurface, lineHeight: 19 },
  trendVenue: { fontSize: 12, color: C.onSurfaceMuted },
  trendPrice: { fontSize: 14, fontWeight: '800', color: C.primaryContainer, marginTop: 4 },

  // Nearby List
  nearbyList: { gap: 12 },
  nearbyCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.surface, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: '#F1F5F9',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 12, elevation: 2,
  },
  nearbyImage: {
    width: 52, height: 52, borderRadius: 12,
    backgroundColor: C.secondary + '15', alignItems: 'center', justifyContent: 'center',
  },
  nearbyBody: { flex: 1 },
  nearbyTitle: { fontSize: 14, fontWeight: '700', color: C.onSurface, marginBottom: 4 },
  nearbyMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  nearbyMetaText: { fontSize: 12, color: C.onSurfaceMuted, flex: 1 },
  nearbyRight: { alignItems: 'flex-end', gap: 4 },
  nearbyDist: { fontSize: 11, color: C.teal, fontWeight: '700' },
  nearbyPrice: { fontSize: 13, fontWeight: '800', color: C.primaryContainer },

  // Empty
  empty: { alignItems: 'center', paddingVertical: 72, gap: 12, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: C.onSurface },
  emptyText: { fontSize: 14, color: C.onSurfaceMuted, textAlign: 'center' },
});
