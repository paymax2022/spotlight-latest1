// ── Marketplace — Notifications feed (§33 · NT-001/002/003) ──────────────────
// The in-app inbox of delivered notifications (distinct from account/notifications
// which is the opt-in preference toggles). Each row deep-links to the listing,
// chat thread, or seller it concerns, and is marked read on tap.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, Bell, Tag, HandCoins, MessageCircle, TrendingDown, Search, Zap, Star, CheckCheck } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { MarketColors } from '@/features/marketplace';
import { useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead } from '@/features/marketplace/api/account.hooks';
import type { MktNotification, MktNotificationType } from '@/features/marketplace/api/account.api';

const ICON: Record<MktNotificationType, typeof Bell> = {
  listing_status: Tag,
  new_offer: HandCoins,
  new_message: MessageCircle,
  price_drop: TrendingDown,
  saved_search: Search,
  boost_expiry: Zap,
  review: Star,
};

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function NotificationsFeedScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const items = data ?? [];
  const unread = useMemo(() => items.filter((n) => !n.read).length, [items]);

  function openTarget(n: MktNotification) {
    if (!n.read) markRead.mutate(n.id);
    if (n.threadId) router.push(`/marketplace/deals/${n.threadId}` as never);
    else if (n.listingId) router.push(`/marketplace/listing/${n.listingId}` as never);
    else if (n.sellerId) router.push(`/marketplace/seller/${n.sellerId}` as never);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back"><ArrowLeft size={24} color={MarketColors.text} /></Pressable>
        <Text style={styles.headerTitle}>Notifications</Text>
        {unread > 0 ? (
          <Pressable onPress={() => markAll.mutate()} hitSlop={8} accessibilityLabel="Mark all read" style={styles.markAll}>
            <CheckCheck size={16} color={MarketColors.brand} />
            <Text style={styles.markAllText}>All read</Text>
          </Pressable>
        ) : <View style={{ width: 24 }} />}
      </View>

      {isLoading ? (
        <View style={styles.centre}><Text style={styles.muted}>Loading…</Text></View>
      ) : isError ? (
        <View style={styles.centre}><Text style={styles.muted}>Couldn’t load your notifications.</Text></View>
      ) : items.length === 0 ? (
        <View style={styles.centre}>
          <Bell size={40} color={MarketColors.muted} />
          <Text style={styles.emptyTitle}>You’re all caught up</Text>
          <Text style={styles.muted}>Offers, messages, and price drops will show up here.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor={MarketColors.brand} />}
          renderItem={({ item }) => {
            const Icon = ICON[item.type] ?? Bell;
            return (
              <Pressable style={[styles.row, !item.read && styles.rowUnread]} onPress={() => openTarget(item)} accessibilityRole="button">
                <View style={[styles.iconWrap, !item.read && styles.iconWrapUnread]}>
                  <Icon size={18} color={item.read ? MarketColors.muted : MarketColors.brand} />
                </View>
                <View style={styles.rowBody}>
                  <View style={styles.rowTop}>
                    <Text style={[styles.rowTitle, !item.read && styles.rowTitleUnread]} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.rowTime}>{timeAgo(item.createdAt)}</Text>
                  </View>
                  <Text style={styles.rowText} numberOfLines={2}>{item.body}</Text>
                </View>
                {!item.read ? <View style={styles.dot} /> : null}
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MarketColors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: MarketColors.border },
  headerTitle: { ...Typography.labelLg, color: MarketColors.text, fontWeight: '700' },
  markAll: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  markAllText: { ...Typography.labelSm, color: MarketColors.brand, fontWeight: '700' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.xl },
  emptyTitle: { ...Typography.labelLg, color: MarketColors.text, fontWeight: '700', marginTop: Spacing.sm },
  muted: { ...Typography.bodySm, color: MarketColors.muted, textAlign: 'center' },
  list: { padding: Spacing.md, gap: Spacing.sm },
  row: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start', padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: MarketColors.surface, borderWidth: 1, borderColor: MarketColors.border },
  rowUnread: { backgroundColor: MarketColors.okBg, borderColor: MarketColors.brand },
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: MarketColors.surfaceAlt },
  iconWrapUnread: { backgroundColor: MarketColors.surface },
  rowBody: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm },
  rowTitle: { ...Typography.labelMd, color: MarketColors.text, fontWeight: '600', flex: 1 },
  rowTitleUnread: { fontWeight: '800' },
  rowTime: { ...Typography.labelSm, color: MarketColors.muted },
  rowText: { ...Typography.bodySm, color: MarketColors.muted },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: MarketColors.brand, marginTop: 6 },
});
