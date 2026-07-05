import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { useOrder, useSetOrderStatus, useAssignRider, useRedispatch, useCancelOrder } from '@/features/food/hooks';
import { useOrderRealtime } from '@/features/food/useOrderRealtime';
import { OrderChatThread, FoodStatusBadge, RiderInfoCard } from '@/features/food/components';
import { formatNaira, STATUS_LABEL, DISPATCH_LABEL, normalizeStatus, toFoodError } from '@/features/food/utils';
import type { OrderStatus } from '@/features/food/types';

type Tab = 'order' | 'chat';

export default function RestaurantOrderScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const [tab, setTab] = useState<Tab>('order');

  const { data: order, isLoading, isError, refetch } = useOrder(orderId, { poll: true });
  const realtime = useOrderRealtime(orderId, { status: order?.status });
  const setStatus = useSetOrderStatus();
  const assignRider = useAssignRider();
  const redispatch = useRedispatch();
  const cancelOrder = useCancelOrder();

  const status = realtime.status ?? order?.status;
  const dispatchStatus = order?.dispatchStatus;

  const advance = (next: OrderStatus) => {
    if (!order) return;
    setStatus.mutate(
      { restaurantId: order.restaurantId, orderId: order.id, status: next },
      { onError: (e) => Alert.alert('Could not update', toFoodError(e).message) },
    );
  };

  // Secondary fallback only — the primary path is server auto-dispatch on 'ready'.
  const onAssign = () => {
    if (!order) return;
    assignRider.mutate(order.id, {
      onError: (e) => Alert.alert('Could not assign rider', toFoodError(e).message),
    });
  };

  const onRedispatch = () => {
    if (!order) return;
    redispatch.mutate(order.id, {
      onError: (e) => Alert.alert('Could not re-dispatch', toFoodError(e).message),
    });
  };

  const onReject = () => {
    if (!order) return;
    Alert.alert('Reject order?', 'This cancels the order and refunds the customer.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Reject',
        style: 'destructive',
        onPress: () => cancelOrder.mutate({ restaurantId: order.restaurantId, orderId: order.id }),
      },
    ]);
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.topBar}>
        <Pressable onPress={() => router.back()} style={s.iconButton} accessibilityLabel="Go back">
          <Icons.ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={s.topTitle}>Manage order</Text>
        <View style={s.iconButton}>{realtime.live ? <View style={s.liveDot} /> : null}</View>
      </View>

      {isLoading ? (
        <StateView kind="loading" />
      ) : isError || !order || !status ? (
        <StateView kind="error" title="Couldn't load order" actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <>
          <View style={s.tabs}>
            {(['order', 'chat'] as Tab[]).map((t) => (
              <Pressable key={t} onPress={() => setTab(t)} style={[s.tab, tab === t && s.tabActive]}>
                <Text style={[s.tabLabel, tab === t && s.tabLabelActive]}>{t === 'order' ? 'Order' : 'Chat'}</Text>
              </Pressable>
            ))}
          </View>

          {tab === 'chat' ? (
            <OrderChatThread orderId={order.id} myRole="restaurant" orderStatus={status} />
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
              <View style={[s.statusCard, shadow1]}>
                <FoodStatusBadge status={status} />
                <Text style={s.headline}>{STATUS_LABEL[status]}</Text>
              </View>

              <View style={[s.card, shadow1]}>
                <Text style={s.cardTitle}>Items</Text>
                {order.items.map((it) => (
                  <View key={it.itemId} style={s.itemRow}>
                    <Text style={s.itemQty}>{it.qty}×</Text>
                    <Text style={s.itemName} numberOfLines={1}>
                      {it.name}
                    </Text>
                    <Text style={s.itemPrice}>{formatNaira(it.priceKobo * it.qty)}</Text>
                  </View>
                ))}
                <View style={s.divider} />
                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>Total</Text>
                  <Text style={s.totalValue}>{formatNaira(order.totalKobo)}</Text>
                </View>
                <Text style={s.addr}>Deliver to: {order.deliveryAddress}</Text>
              </View>

              {/* Dispatch state — after 'ready' the server auto-dispatches riders. */}
              {normalizeStatus(status) === 'ready' && dispatchStatus && dispatchStatus !== 'none' ? (
                <View style={[s.dispatchCard, shadow1]}>
                  {dispatchStatus === 'searching' ? (
                    <Icons.Bike size={18} color={Colors.secondary} strokeWidth={2} />
                  ) : (
                    <Icons.CircleCheck size={18} color={Colors.tertiaryContainer} strokeWidth={2} />
                  )}
                  <Text style={s.dispatchText}>{DISPATCH_LABEL[dispatchStatus]}</Text>
                </View>
              ) : null}

              {order.rider ? (
                <View style={s.block}>
                  <RiderInfoCard rider={order.rider} />
                </View>
              ) : null}

              <View style={s.actions}>
                {normalizeStatus(status) === 'placed' ? (
                  <>
                    <PrimaryButton label="Confirm order" onPress={() => advance('confirmed')} loading={setStatus.isPending} />
                    <PrimaryButton label="Reject order" variant="danger" loading={cancelOrder.isPending} onPress={onReject} />
                  </>
                ) : null}
                {normalizeStatus(status) === 'accepted' ? (
                  <PrimaryButton label="Start preparing" onPress={() => advance('preparing')} loading={setStatus.isPending} />
                ) : null}
                {status === 'preparing' ? (
                  <PrimaryButton label="Mark ready for pickup" onPress={() => advance('ready')} loading={setStatus.isPending} />
                ) : null}
                {/* After ready: auto-dispatch handles riders. Offer re-dispatch while still searching. */}
                {normalizeStatus(status) === 'ready' && !order.rider && dispatchStatus !== 'assigned' ? (
                  <PrimaryButton label="Re-dispatch to riders" onPress={onRedispatch} loading={redispatch.isPending} />
                ) : null}
                {/* Secondary fallback: manually assign a rider only if still unassigned. */}
                {normalizeStatus(status) === 'ready' && !order.rider ? (
                  <PrimaryButton label="Assign a rider manually" variant="secondary" onPress={onAssign} loading={assignRider.isPending} />
                ) : null}
                <PrimaryButton label="Message customer & rider" variant="secondary" onPress={() => setTab('chat')} />
              </View>
            </ScrollView>
          )}
        </>
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
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.tertiaryContainer },
  topTitle: { ...Typography.titleLg, color: Colors.primary },
  tabs: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  tab: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow },
  tabActive: { backgroundColor: Colors.primary },
  tabLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  tabLabelActive: { color: Colors.white },
  content: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  statusCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: 6 },
  headline: { ...Typography.titleMd, color: Colors.onSurface },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginTop: Spacing.md },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 4 },
  itemQty: { ...Typography.labelMd, color: Colors.secondary, minWidth: 28 },
  itemName: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  itemPrice: { ...Typography.labelMd, color: Colors.onSurface },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: Spacing.sm },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { ...Typography.labelLg, color: Colors.onSurface },
  totalValue: { ...Typography.titleMd, color: Colors.primary },
  addr: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  block: { marginTop: Spacing.md },
  actions: { marginTop: Spacing.lg, gap: Spacing.sm },
  dispatchCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgBlue, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.md },
  dispatchText: { ...Typography.labelMd, color: Colors.secondary, flex: 1 },
});
