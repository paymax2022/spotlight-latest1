import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { confirmAsync } from '@/lib/confirm';
import * as Icons from 'lucide-react-native';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import MobilityMap from '@/features/mobility/components/MobilityMap';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { useOrder, useCancelOrder } from '@/features/food/hooks';
import { useOrderRealtime } from '@/features/food/useOrderRealtime';
import { OrderTimeline, OrderChatThread, FoodStatusBadge, RiderInfoCard } from '@/features/food/components';
import { formatNaira, STATUS_LABEL, isLiveTrackable, isTerminalStatus, normalizeStatus } from '@/features/food/utils';

type Tab = 'tracking' | 'chat';

export default function OrderTrackingScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const [tab, setTab] = useState<Tab>('tracking');

  const { data: order, isLoading, isError, refetch } = useOrder(orderId, { poll: true });
  const realtime = useOrderRealtime(orderId, { status: order?.status });
  const cancelOrder = useCancelOrder();

  // Prefer the live socket frame for status/location; fall back to the polled order.
  const status = realtime.status ?? order?.status;
  const riderLocation = realtime.riderLocation ?? order?.rider?.location ?? null;
  const dispatchStatus = order?.dispatchStatus;
  const deliveryCode = order?.deliveryCode ?? null;
  // Show the handoff code while the order is ready / in transit and a code exists.
  const showHandoffCode = useMemo(() => {
    if (!status || !deliveryCode) return false;
    const s = normalizeStatus(status);
    return s === 'ready' || s === 'assigned' || s === 'picked_up';
  }, [status, deliveryCode]);

  const canCancel = useMemo(() => {
    if (!status) return false;
    const s = normalizeStatus(status);
    return s === 'placed' || s === 'accepted';
  }, [status]);

  const onCancel = async () => {
    if (!order) return;
    const ok = await confirmAsync({ title: 'Cancel order?', message: 'This will cancel your order. You will be refunded if already charged.', confirmLabel: 'Cancel order', cancelLabel: 'Keep order', destructive: true });
    if (ok) cancelOrder.mutate({ restaurantId: order.restaurantId, orderId: order.id });
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.topBar}>
        <Pressable onPress={() => goBack('/food/orders')} style={s.iconButton} accessibilityLabel="Go back">
          <Icons.ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={s.topTitle}>Your order</Text>
        <View style={s.iconButton}>
          {realtime.live ? <View style={s.liveDot} /> : null}
        </View>
      </View>

      {isLoading ? (
        <StateView kind="loading" message="Loading your order…" />
      ) : isError || !order || !status ? (
        <StateView kind="error" title="Couldn't load this order" actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <>
          {/* Tabs */}
          <View style={s.tabs}>
            {(['tracking', 'chat'] as Tab[]).map((t) => (
              <Pressable key={t} onPress={() => setTab(t)} style={[s.tab, tab === t && s.tabActive]}>
                <Text style={[s.tabLabel, tab === t && s.tabLabelActive]}>{t === 'tracking' ? 'Tracking' : 'Chat'}</Text>
              </Pressable>
            ))}
          </View>

          {tab === 'chat' ? (
            <OrderChatThread orderId={order.id} myRole="customer" orderStatus={status} />
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
              {/* Status banner */}
              <View style={[s.statusCard, shadow1]}>
                <FoodStatusBadge status={status} />
                <Text style={s.statusHeadline}>{STATUS_LABEL[status]}</Text>
                <Text style={s.statusSub}>{order.restaurantName}</Text>
              </View>

              {/* Edge states */}
              {status === 'no_rider' ? (
                <View style={[s.edgeCard, shadow1]}>
                  <Text style={s.edgeTitle}>No rider available yet</Text>
                  <Text style={s.edgeMsg}>We're still looking for a rider. Your food is safe — we'll assign one shortly.</Text>
                </View>
              ) : null}
              {status === 'cancelled' ? (
                <View style={[s.edgeCard, shadow1]}>
                  <Text style={s.edgeTitle}>Order cancelled</Text>
                  <Text style={s.edgeMsg}>This order was cancelled. Any charge will be refunded.</Text>
                </View>
              ) : null}

              {/* Finding-a-rider banner (server is auto-dispatching) */}
              {normalizeStatus(status) === 'ready' && dispatchStatus === 'searching' ? (
                <View style={[s.dispatchCard, shadow1]}>
                  <Icons.Bike size={18} color={Colors.secondary} strokeWidth={2} />
                  <Text style={s.dispatchText}>Finding a rider for your order…</Text>
                </View>
              ) : null}

              {/* Handoff code — give this to the rider at the door */}
              {showHandoffCode && deliveryCode ? (
                <View style={[s.codeCard, shadow1]}>
                  <View style={s.codeHead}>
                    <Icons.KeyRound size={18} color={Colors.tertiaryContainer} strokeWidth={2} />
                    <Text style={s.codeTitle}>Your delivery code</Text>
                  </View>
                  <Text style={s.codeValue}>{deliveryCode}</Text>
                  <Text style={s.codeHint}>Give this code to your rider at the door: {deliveryCode}</Text>
                </View>
              ) : null}

              {/* Live map while a rider is en route */}
              {isLiveTrackable(status) ? (
                <View style={s.mapWrap}>
                  <MobilityMap
                    pickup={order.restaurantLocation}
                    dropoff={order.deliveryLocation}
                    driver={riderLocation}
                    height={220}
                    caption="Live rider tracking"
                  />
                </View>
              ) : null}

              {/* Rider card */}
              {order.rider && !isTerminalStatus(status) ? (
                <View style={s.block}>
                  <RiderInfoCard rider={{ ...order.rider, location: riderLocation }} />
                </View>
              ) : null}

              {/* Timeline */}
              {!isTerminalStatus(status) || status === 'delivered' ? (
                <View style={[s.block, s.card, shadow1]}>
                  <Text style={s.cardTitle}>Order status</Text>
                  <OrderTimeline status={status} dispatchStatus={dispatchStatus} />
                </View>
              ) : null}

              {/* Items + total */}
              <View style={[s.block, s.card, shadow1]}>
                <Text style={s.cardTitle}>Order summary</Text>
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
                <Text style={s.addr}>Delivering to: {order.deliveryAddress}</Text>
              </View>

              {/* Actions */}
              <View style={s.actions}>
                {status === 'delivered' && !order.rated ? (
                  <PrimaryButton label="Rate your order" onPress={() => router.push(`/food/orders/${order.id}/rate`)} />
                ) : null}
                {canCancel ? (
                  <PrimaryButton label="Cancel order" variant="danger" loading={cancelOrder.isPending} onPress={onCancel} />
                ) : null}
                <PrimaryButton label="Message restaurant & rider" variant="secondary" onPress={() => setTab('chat')} />
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
  statusHeadline: { ...Typography.titleMd, color: Colors.onSurface },
  statusSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  edgeCard: { backgroundColor: Colors.errorContainer, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.md, gap: 4 },
  edgeTitle: { ...Typography.labelLg, color: Colors.error },
  edgeMsg: { ...Typography.bodySm, color: Colors.onSurface },
  dispatchCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgBlue, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.md },
  dispatchText: { ...Typography.labelMd, color: Colors.secondary, flex: 1 },
  codeCard: { backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.md, alignItems: 'center', gap: 4 },
  codeHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  codeTitle: { ...Typography.labelLg, color: Colors.tertiaryContainer },
  codeValue: { ...Typography.headlineMd, color: Colors.tertiaryContainer, fontWeight: '800', letterSpacing: 6, marginVertical: 4 },
  codeHint: { ...Typography.bodySm, color: Colors.onSurface, textAlign: 'center' },
  mapWrap: { marginTop: Spacing.md },
  block: { marginTop: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
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
  actions: { marginTop: Spacing.lg, gap: Spacing.sm },
});
