import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import * as Icons from 'lucide-react-native';
import StateView from '@/components/StateView';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { useOrders } from '@/features/food/hooks';
import { useRestaurantQueueRealtime } from '@/features/food/useRestaurantQueueRealtime';
import { OrderListRow } from '@/features/food/components';
import { isTerminalStatus } from '@/features/food/utils';

export default function RestaurantQueueScreen() {
  // Live order events over the user-scoped socket. A merchant's critical event
  // is a NEW order, which cannot be subscribed to per-order because the id does
  // not exist client-side yet — see useRestaurantQueueRealtime.
  //
  // Named socketLive, not `live`: `live` below is the ACTIVE-ORDER list, and the
  // two mean very different things.
  const { live: socketLive } = useRestaurantQueueRealtime(true);

  // Polling becomes the FALLBACK rather than the mechanism: every 6s while the
  // socket is down (or under mock), backing off to 60s while it is up — kept
  // non-zero purely as a safety net against a dropped frame, since a merchant
  // silently missing an order is the worst failure this screen has.
  const { data, isLoading, isError, refetch } = useOrders('restaurant', {
    poll: true,
    pollMs: socketLive ? 60_000 : 6_000,
  });

  const live = (data ?? []).filter((o) => !isTerminalStatus(o.status));
  const past = (data ?? []).filter((o) => isTerminalStatus(o.status));

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.topBar}>
        <Pressable onPress={() => goBack('/food')} style={s.iconButton} accessibilityLabel="Go back">
          <Icons.ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <View style={s.titleWrap}>
          <Text style={s.topTitle}>Restaurant · Orders</Text>
          {/* Honest indicator: only lit when the socket is actually connected,
              so a merchant can tell "quiet night" from "not receiving". */}
          {socketLive ? (
            <View style={s.livePill}>
              <View style={s.liveDot} />
              <Text style={s.liveLabel}>Live</Text>
            </View>
          ) : null}
        </View>
        <Pressable onPress={() => router.push('/food/restaurant/manage')} style={s.iconButton} accessibilityLabel="Manage store">
          <Icons.Store size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
      </View>

      {/* This gate covers the ORDER LIST only. It used to wrap the tab content
          too, so Earnings and Manage rendered nothing at all whenever the queue
          was empty — which is the state of every person who has not started
          selling yet, i.e. exactly the people who need Manage to set a store up.
          The tabs are real navigation now (see the bottom bar), so nothing else
          depends on this branch. */}
      {isLoading ? (
        <StateView kind="loading" message="Loading the order queue…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load orders" actionLabel="Retry" onAction={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <StateView
          kind="empty"
          icon="Store"
          title="No orders yet"
          message="Incoming orders will appear here in real time. If you haven't set your restaurant up, start there."
          actionLabel="Set up your restaurant"
          onAction={() => router.push('/food/restaurant/manage')}
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
          <Text style={s.sectionTitle}>Active ({live.length})</Text>
          {live.length === 0 ? <Text style={s.empty}>No active orders.</Text> : null}
          {live.map((order) => (
            <OrderListRow key={order.id} order={order} onPress={() => router.push(`/food/restaurant/order/${order.id}`)} />
          ))}

          {past.length ? (
            <>
              <Text style={s.sectionTitle}>Completed</Text>
              {past.map((order) => (
                <OrderListRow key={order.id} order={order} onPress={() => router.push(`/food/restaurant/order/${order.id}`)} />
              ))}
            </>
          ) : null}
        </ScrollView>
      )}

      {/* Bottom navigation.
          These were local tab-state toggles, and selecting one rendered a text
          link that had to be tapped AGAIN to reach the screen — when it rendered
          at all. They are destinations, so they navigate. Orders is this screen,
          hence the selected styling on it and no press handler. */}
      <View style={[s.bottomMenu, shadow1]}>
        <View style={[s.menuItem, s.menuItemActive]} accessibilityRole="tab" accessibilityState={{ selected: true }}>
          <Icons.ReceiptText size={20} color={Colors.primary} strokeWidth={2} />
          <Text style={[s.menuLabel, s.menuLabelActive]}>Orders</Text>
        </View>

        <Pressable
          style={s.menuItem}
          onPress={() => router.push('/food/restaurant/earnings')}
          accessibilityRole="tab"
          accessibilityLabel="Earnings"
          accessibilityState={{ selected: false }}
        >
          <Icons.TrendingUp size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={s.menuLabel}>Earnings</Text>
        </Pressable>

        <Pressable
          style={s.menuItem}
          onPress={() => router.push('/food/restaurant/manage')}
          accessibilityRole="tab"
          accessibilityLabel="Manage"
          accessibilityState={{ selected: false }}
        >
          <Icons.Settings size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={s.menuLabel}>Manage</Text>
        </Pressable>
      </View>
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
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceContainerHigh,
    backgroundColor: 'rgba(248,249,255,0.92)',
  },
  iconButton: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  titleWrap: { alignItems: 'center', gap: 2 },
  topTitle: { ...Typography.titleLg, color: Colors.primary },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#16A34A' },
  liveLabel: { ...Typography.labelSm, color: '#16A34A' },
  content: { padding: Spacing.containerMargin, paddingBottom: Platform.OS === 'ios' ? 100 : 80 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.md, marginTop: Spacing.xs },
  empty: { ...Typography.bodySm, color: Colors.outline, marginBottom: Spacing.lg },
  bottomMenu: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    backgroundColor: Colors.surfaceContainerLowest,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceContainerHigh,
    paddingBottom: Platform.OS === 'ios' ? 20 : 12,
    paddingTop: Spacing.sm,
  },
  menuItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
    gap: 4,
  },
  menuItemActive: {
    borderBottomWidth: 2,
    borderBottomColor: Colors.primary,
  },
  menuLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  menuLabelActive: { ...Typography.labelSm, color: Colors.primary, fontWeight: '600' as const },
});
