import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, Zap, TrendingUp } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import StateView from '@/components/StateView';
import { MarketColors, formatNaira } from '@/features/marketplace';
import { useBoostedListings } from '@/features/marketplace/hooks';
import ListingCard from '@/features/marketplace/components/ListingCard';
import { GridSkeleton } from '@/features/marketplace/components/Skeletons';

// The door behind the home screen's "Boosted" rail's View More: every listing with
// a live boost right now, in the order the server puts them — the promotion with
// the most UNSPENT money left leads, not the one that once paid the most. The
// client never re-sorts this; the ordering is the whole point of the section.
export default function BoostedListingsScreen() {
  const listings = useBoostedListings();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Back to Marketplace">
          <ChevronLeft size={24} color={Colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Boosted</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={listings.isFetching} onRefresh={() => listings.refetch()} tintColor={MarketColors.brand} />}
      >
        <View style={styles.explainer}>
          <Zap size={16} color={MarketColors.brand} />
          <Text style={styles.explainerText}>
            Sellers paid to promote these listings. The one with the most promotion still left to run is first.
          </Text>
        </View>

        {listings.isLoading && !listings.data ? (
          <GridSkeleton rows={2} />
        ) : listings.isError && !listings.data ? (
          <StateView
            kind="error"
            compact
            title="Couldn't load boosted listings"
            message="Check your connection and try again."
            actionLabel="Retry"
            onAction={() => listings.refetch()}
          />
        ) : (listings.data ?? []).length === 0 ? (
          <StateView
            kind="empty"
            compact
            icon="Zap"
            title="Nothing is being promoted"
            message="No seller has an active boost right now. Sellers can boost a listing from My listings."
          />
        ) : (
          <View style={styles.grid}>
            {(listings.data ?? []).map((l) => (
              <View key={l.id} style={styles.gridItem}>
                <ListingCard item={l} onPress={(id) => router.push(`/marketplace/listing/${id}?source=boosted` as never)} />
                {/* Say WHY the card sits where it does, in the buyer's money terms —
                    the ordering is invisible otherwise. */}
                <View style={styles.remainingRow}>
                  <TrendingUp size={12} color={MarketColors.muted} />
                  <Text style={styles.remainingText}>
                    {formatNaira(l.boostRemainingKobo)} of boost left · ends {formatEndsAt(l.boostEndsAt)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function formatEndsAt(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'soon';
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `in ${days} day${days === 1 ? '' : 's'}`;
  return `in ${Math.max(1, Math.floor(ms / 3_600_000))} hr`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -6 },
  headerTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  scroll: { paddingBottom: Spacing.xxl },
  explainer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.md, backgroundColor: MarketColors.warnBg, borderRadius: Radius.md, padding: Spacing.sm },
  explainerText: { ...Typography.labelSm, color: MarketColors.warnText, flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, paddingHorizontal: Spacing.containerMargin },
  // 48% matches GridSkeleton's own cell width, so the grid does not reflow when
  // the skeletons are replaced by real cards.
  gridItem: { width: '48%', flexGrow: 1 },
  remainingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  remainingText: { ...Typography.caption, color: MarketColors.muted, flexShrink: 1 },
});
