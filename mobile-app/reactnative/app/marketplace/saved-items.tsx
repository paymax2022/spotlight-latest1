// ── Screen 8 — Saved Items (wishlist) ────────────────────────────────────────
// Return-later list. Grid of saved cards with a "price changed" badge when the
// current price differs from the price at save time. Empty state is an invitation
// ("Save items you're considering — we'll tell you if the price drops"), not a
// bare blank grid.
import React from 'react';
import { View, Text, StyleSheet, Pressable, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, ArrowDown, ArrowUp, HeartOff } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { MarketColors, formatNaira } from '@/features/marketplace';
import { useSavedItems } from '@/features/marketplace/hooks';

export default function SavedItems() {
  const saved = useSavedItems();
  const items = saved.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topRow}>
        <Pressable onPress={() => goBack('/marketplace')} hitSlop={10} accessibilityLabel="Back"><ArrowLeft size={22} color={Colors.onSurface} /></Pressable>
        <Text style={styles.title}>Saved items</Text>
      </View>

      {saved.isLoading && !saved.data ? (
        <StateView kind="loading" message="Loading your wishlist…" />
      ) : items.length === 0 ? (
        <StateView
          kind="empty"
          icon="Heart"
          title="Nothing saved yet"
          message="Save items you're considering — we'll tell you if the price drops."
          actionLabel="Browse marketplace"
          onAction={() => router.push('/marketplace' as never)}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.listing.id}
          numColumns={2}
          columnWrapperStyle={styles.col}
          contentContainerStyle={styles.grid}
          renderItem={({ item }) => {
            const current = item.listing.priceKobo;
            const delta = current - item.savedPriceKobo;
            const dropped = delta < 0;
            const rose = delta > 0;
            return (
              <Pressable style={styles.card} onPress={() => router.push(`/marketplace/listing/${item.listing.id}?source=saved` as never)}>
                <View style={styles.image} />
                {dropped || rose ? (
                  <View style={[styles.priceBadge, dropped ? styles.priceBadgeDrop : styles.priceBadgeRise]}>
                    {dropped ? <ArrowDown size={11} color="#FFFFFF" /> : <ArrowUp size={11} color="#FFFFFF" />}
                    <Text style={styles.priceBadgeText}>{dropped ? 'Price drop' : 'Price up'}</Text>
                  </View>
                ) : null}
                <Text style={styles.cardTitle} numberOfLines={1}>{item.listing.title}</Text>
                <Text style={styles.cardPrice}>{formatNaira(current)}</Text>
                {dropped ? <Text style={styles.wasPrice}>was {formatNaira(item.savedPriceKobo)}</Text> : null}
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  title: { ...Typography.titleLg, color: Colors.onSurface },
  grid: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: Spacing.xxl },
  col: { gap: Spacing.sm },
  card: { flex: 1, backgroundColor: MarketColors.surface, borderRadius: Radius.lg, padding: Spacing.sm },
  image: { height: 120, borderRadius: Radius.md, backgroundColor: MarketColors.surfaceAlt },
  priceBadge: { position: 'absolute', top: 14, left: 14, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  priceBadgeDrop: { backgroundColor: MarketColors.ok },
  priceBadgeRise: { backgroundColor: MarketColors.muted },
  priceBadgeText: { fontSize: 10, fontWeight: '700', color: '#FFFFFF' },
  cardTitle: { ...Typography.labelLg, color: MarketColors.text, marginTop: Spacing.xs },
  cardPrice: { ...Typography.titleMd, color: MarketColors.brand, marginTop: 2 },
  wasPrice: { ...Typography.labelSm, color: MarketColors.muted, textDecorationLine: 'line-through' },
});
