import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import StateView from '@/components/StateView';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { useOrders } from '@/features/food/hooks';
import { OrderListRow } from '@/features/food/components';
import { isTerminalStatus } from '@/features/food/utils';

export default function RestaurantQueueScreen() {
  const { data, isLoading, isError, refetch } = useOrders('restaurant', { poll: true });

  const live = (data ?? []).filter((o) => !isTerminalStatus(o.status));
  const past = (data ?? []).filter((o) => isTerminalStatus(o.status));

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.topBar}>
        <Pressable onPress={() => router.back()} style={s.iconButton} accessibilityLabel="Go back">
          <Icons.ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={s.topTitle}>Restaurant · Orders</Text>
        <View style={s.iconButton} />
      </View>

      {isLoading ? (
        <StateView kind="loading" message="Loading the order queue…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load orders" actionLabel="Retry" onAction={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <StateView kind="empty" icon="Store" title="No orders yet" message="Incoming orders will appear here in real time." />
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
  content: { padding: Spacing.containerMargin },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.md, marginTop: Spacing.xs },
  empty: { ...Typography.bodySm, color: Colors.outline, marginBottom: Spacing.lg },
});
