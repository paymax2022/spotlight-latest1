import React, { useState } from 'react';
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
import { OrderListRow } from '@/features/food/components';
import { isTerminalStatus } from '@/features/food/utils';

type MenuTab = 'orders' | 'earnings' | 'manage';

export default function RestaurantQueueScreen() {
  const [activeTab, setActiveTab] = useState<MenuTab>('orders');
  const { data, isLoading, isError, refetch } = useOrders('restaurant', { poll: true });

  const live = (data ?? []).filter((o) => !isTerminalStatus(o.status));
  const past = (data ?? []).filter((o) => isTerminalStatus(o.status));

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.topBar}>
        <Pressable onPress={() => goBack('/food')} style={s.iconButton} accessibilityLabel="Go back">
          <Icons.ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={s.topTitle}>Restaurant · Orders</Text>
        <Pressable onPress={() => router.push('/food/restaurant/manage')} style={s.iconButton} accessibilityLabel="Manage store">
          <Icons.Store size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
      </View>

      {isLoading ? (
        <StateView kind="loading" message="Loading the order queue…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load orders" actionLabel="Retry" onAction={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <StateView kind="empty" icon="Store" title="No orders yet" message="Incoming orders will appear here in real time." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
          {activeTab === 'orders' && (
            <>
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
            </>
          )}
          {activeTab === 'earnings' && (
            <Pressable onPress={() => router.push('/food/restaurant/earnings')} style={{ marginTop: Spacing.lg }}>
              <Text style={s.sectionTitle}>View earnings details</Text>
            </Pressable>
          )}
          {activeTab === 'manage' && (
            <Pressable onPress={() => router.push('/food/restaurant/manage')} style={{ marginTop: Spacing.lg }}>
              <Text style={s.sectionTitle}>Manage your store</Text>
            </Pressable>
          )}
        </ScrollView>
      )}

      {/* Bottom menu navigation */}
      <View style={[s.bottomMenu, shadow1]}>
        <Pressable
          style={[s.menuItem, activeTab === 'orders' && s.menuItemActive]}
          onPress={() => setActiveTab('orders')}
          accessibilityRole="tab"
          accessibilityLabel="Orders"
          accessibilityState={{ selected: activeTab === 'orders' }}
        >
          <Icons.ReceiptText size={20} color={activeTab === 'orders' ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={[s.menuLabel, activeTab === 'orders' && s.menuLabelActive]}>Orders</Text>
        </Pressable>

        <Pressable
          style={[s.menuItem, activeTab === 'earnings' && s.menuItemActive]}
          onPress={() => setActiveTab('earnings')}
          accessibilityRole="tab"
          accessibilityLabel="Earnings"
          accessibilityState={{ selected: activeTab === 'earnings' }}
        >
          <Icons.TrendingUp size={20} color={activeTab === 'earnings' ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={[s.menuLabel, activeTab === 'earnings' && s.menuLabelActive]}>Earnings</Text>
        </Pressable>

        <Pressable
          style={[s.menuItem, activeTab === 'manage' && s.menuItemActive]}
          onPress={() => setActiveTab('manage')}
          accessibilityRole="tab"
          accessibilityLabel="Manage"
          accessibilityState={{ selected: activeTab === 'manage' }}
        >
          <Icons.Settings size={20} color={activeTab === 'manage' ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={[s.menuLabel, activeTab === 'manage' && s.menuLabelActive]}>Manage</Text>
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
  topTitle: { ...Typography.titleLg, color: Colors.primary },
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
