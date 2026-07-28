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

import { listRestaurants } from '@/api/restaurant.api';
import { AppLoader } from '@/components/ui/AppLoader';
import { colors } from '@/theme';
import { formatCurrency } from '@/utils/format';
import type { Restaurant } from '@/types/fintech';

const CUISINES = ['All', 'Nigerian', 'Chinese', 'Fast Food', 'Pizza', 'Salads'];

function StarRating({ rating }: { rating: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <Ionicons name="star" size={12} color="#F39C12" />
      <Text style={{ fontSize: 12, color: colors.neutral.textMuted, fontWeight: '600' }}>
        {rating.toFixed(1)}
      </Text>
    </View>
  );
}

function RestaurantCard({ restaurant, onPress }: { restaurant: Restaurant; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
    >
      <View style={styles.cardImage}>
        <View style={styles.cardImagePlaceholder}>
          <Ionicons name="restaurant" size={32} color={colors.neutral.placeholder} />
        </View>
        {!restaurant.is_open && (
          <View style={styles.closedOverlay}>
            <Text style={styles.closedText}>Closed</Text>
          </View>
        )}
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardName} numberOfLines={1}>{restaurant.name}</Text>
          <StarRating rating={restaurant.rating} />
        </View>
        <Text style={styles.cardCuisine}>{restaurant.cuisine}</Text>
        <View style={styles.cardMeta}>
          <View style={styles.metaPill}>
            <Ionicons name="time-outline" size={12} color={colors.neutral.textMuted} />
            <Text style={styles.metaText}>{restaurant.delivery_time_min} min</Text>
          </View>
          <View style={styles.metaPill}>
            <Ionicons name="bicycle-outline" size={12} color={colors.neutral.textMuted} />
            <Text style={styles.metaText}>{formatCurrency(restaurant.delivery_fee_kobo, 'NGN')}</Text>
          </View>
          <View style={styles.metaPill}>
            <Ionicons name="location-outline" size={12} color={colors.neutral.textMuted} />
            <Text style={styles.metaText}>{restaurant.distance_km?.toFixed(1)} km</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

export default function RestaurantListScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [cuisine, setCuisine] = useState('All');

  const query = useQuery({
    queryKey: ['restaurants', cuisine, search],
    queryFn: () => listRestaurants({ cuisine: cuisine === 'All' ? undefined : cuisine, search }),
  });

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.neutral.white} />
        </Pressable>
        <Text style={styles.headerTitle}>Food & Restaurant</Text>
        <View style={{ width: 38 }} />
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color={colors.neutral.placeholder} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search restaurants..."
            placeholderTextColor={colors.neutral.placeholder}
            value={search}
            onChangeText={setSearch}
          />
        </View>
      </View>

      {/* Cuisine Filters */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll} contentContainerStyle={styles.filtersContent}>
        {CUISINES.map((c) => (
          <Pressable
            key={c}
            style={[styles.filterChip, cuisine === c && styles.filterChipActive]}
            onPress={() => setCuisine(c)}
          >
            <Text style={[styles.filterChipText, cuisine === c && styles.filterChipTextActive]}>{c}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* List */}
      {query.isLoading ? (
        <AppLoader />
      ) : query.isError ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Failed to load restaurants</Text>
          <Pressable style={styles.retryBtn} onPress={() => query.refetch()}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} />}
        >
          {(query.data ?? []).length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="restaurant-outline" size={48} color={colors.neutral.placeholder} />
              <Text style={styles.emptyText}>No restaurants found</Text>
            </View>
          ) : (
            (query.data ?? []).map((r) => (
              <RestaurantCard
                key={r.id}
                restaurant={r}
                onPress={() => router.push(`/restaurant/${r.id}` as never)}
              />
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.primary.DEFAULT,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.neutral.white },
  searchRow: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8, backgroundColor: colors.neutral.background },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.neutral.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.neutral.border,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.neutral.text },
  filtersScroll: { maxHeight: 48, flexGrow: 0 },
  filtersContent: { paddingHorizontal: 16, gap: 8, alignItems: 'center' },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: colors.neutral.surface,
    borderWidth: 1,
    borderColor: colors.neutral.border,
  },
  filterChipActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  filterChipText: { fontSize: 13, color: colors.neutral.textMuted, fontWeight: '500' },
  filterChipTextActive: { color: colors.neutral.white },
  list: { padding: 16, gap: 12 },
  card: {
    backgroundColor: colors.neutral.surface,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
  },
  cardPressed: { opacity: 0.9 },
  cardImage: { height: 140, backgroundColor: colors.neutral.surfaceAlt, position: 'relative' },
  cardImagePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  closedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closedText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  cardBody: { padding: 14 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardName: { fontSize: 16, fontWeight: '700', color: colors.neutral.text, flex: 1 },
  cardCuisine: { fontSize: 13, color: colors.neutral.textMuted, marginBottom: 10 },
  cardMeta: { flexDirection: 'row', gap: 10 },
  metaPill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: colors.neutral.textMuted },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 15, color: colors.neutral.textMuted },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: colors.primary.DEFAULT, borderRadius: 10 },
  retryText: { color: '#fff', fontWeight: '600' },
});
