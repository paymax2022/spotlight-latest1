// ── Marketplace — Followed sellers (LD-005) ──────────────────────────────────
// The list of sellers the user follows; tap to open a seller profile, or unfollow
// inline. Following a seller surfaces their new listings in the notifications feed.
import React from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Star, UserCheck, Store } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { MarketColors } from '@/features/marketplace';
import { useFollowedSellers, useUnfollowSeller } from '@/features/marketplace/api/account.hooks';
import { HomeMenuButton } from '@/components/HomeMenu';

export default function FollowingScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useFollowedSellers();
  const unfollow = useUnfollowSeller();
  const items = data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/marketplace/account')} hitSlop={12} accessibilityLabel="Back"><ArrowLeft size={24} color={MarketColors.text} /></Pressable>
        <Text style={styles.headerTitle}>Following</Text>
        <HomeMenuButton />
      </View>

      {isLoading ? (
        <View style={styles.centre}><Text style={styles.muted}>Loading…</Text></View>
      ) : isError ? (
        <View style={styles.centre}><Text style={styles.muted}>Couldn’t load followed sellers.</Text></View>
      ) : items.length === 0 ? (
        <View style={styles.centre}>
          <Store size={40} color={MarketColors.muted} />
          <Text style={styles.emptyTitle}>You’re not following anyone yet</Text>
          <Text style={styles.muted}>Follow a seller from their profile to get their new listings in your notifications.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(f) => f.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor={MarketColors.brand} />}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => router.push(`/marketplace/seller/${item.sellerId}` as never)} accessibilityRole="button">
              <View style={styles.avatar}><Text style={styles.avatarText}>{item.sellerName[0]?.toUpperCase()}</Text></View>
              <View style={styles.rowBody}>
                <Text style={styles.name} numberOfLines={1}>{item.sellerName}</Text>
                <View style={styles.metaRow}>
                  <Star size={13} color={MarketColors.warn} fill={MarketColors.warn} />
                  <Text style={styles.meta}>{(item.trustScore * 5).toFixed(1)}</Text>
                  <Text style={styles.metaDot}>·</Text>
                  <Text style={styles.meta}>{item.activeListings} active</Text>
                </View>
              </View>
              <Pressable
                style={styles.unfollowBtn}
                onPress={() => unfollow.mutate(item.sellerId)}
                disabled={unfollow.isPending}
                hitSlop={8}
                accessibilityLabel={`Unfollow ${item.sellerName}`}
              >
                <UserCheck size={16} color="#fff" />
                <Text style={styles.unfollowText}>Following</Text>
              </Pressable>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MarketColors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: MarketColors.border },
  headerTitle: { ...Typography.labelLg, color: MarketColors.text, fontWeight: '700' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.xl },
  emptyTitle: { ...Typography.labelLg, color: MarketColors.text, fontWeight: '700', marginTop: Spacing.sm },
  muted: { ...Typography.bodySm, color: MarketColors.muted, textAlign: 'center' },
  list: { padding: Spacing.md, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: MarketColors.surface, borderWidth: 1, borderColor: MarketColors.border },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: MarketColors.okBg, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...Typography.labelLg, color: MarketColors.brand, fontWeight: '800' },
  rowBody: { flex: 1, gap: 3 },
  name: { ...Typography.labelMd, color: MarketColors.text, fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { ...Typography.labelSm, color: MarketColors.muted },
  metaDot: { color: MarketColors.muted },
  unfollowBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: MarketColors.brand, borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 7 },
  unfollowText: { ...Typography.labelSm, color: '#fff', fontWeight: '700' },
});
