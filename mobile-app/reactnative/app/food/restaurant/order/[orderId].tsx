import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { confirmAsync, alertAsync } from '@/lib/confirm';
import * as Icons from 'lucide-react-native';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import { useOrder, useSetOrderStatus, useAssignRider, useRedispatch, useCancelOrder, useConfirmPickupAsMerchant, useAssignTable, useMarkServed, useMarkClosed } from '@/features/food/hooks';
import { merchantActions, orderTypeOf, usesRider, ORDER_TYPE_LABEL } from '@/features/food/orderType';
import { useOrderRealtime } from '@/features/food/useOrderRealtime';
import { OrderChatThread, FoodStatusBadge, RiderInfoCard } from '@/features/food/components';
import { formatNaira, STATUS_LABEL, DISPATCH_LABEL, normalizeStatus, toFoodError } from '@/features/food/utils';
import type { OrderStatus } from '@/features/food/types';
import { HomeMenuButton } from '@/components/HomeMenu';

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
  const verifyPickup = useConfirmPickupAsMerchant();
  const assignTable = useAssignTable();
  const markServed = useMarkServed();
  const markClosed = useMarkClosed();
  const [verifyCode, setVerifyCode] = useState('');
  const [tableInput, setTableInput] = useState('');

  const status = realtime.status ?? order?.status;
  const dispatchStatus = order?.dispatchStatus;
  const type = orderTypeOf(order);
  const acts = order ? merchantActions({ orderType: type, status: status ?? order.status }) : null;

  const onVerify = () => {
    if (!order || !/^\d{4,8}$/.test(verifyCode.trim())) {
      alertAsync({ title: 'Enter the code', message: 'Ask the customer for their numeric pickup code.' });
      return;
    }
    verifyPickup.mutate(
      { orderId: order.id, code: verifyCode.trim() },
      {
        onSuccess: () => setVerifyCode(''),
        onError: (e) => alertAsync({ title: 'Code not accepted', message: toFoodError(e).message }),
      },
    );
  };

  const onAssignTable = () => {
    if (!order || !tableInput.trim()) return;
    assignTable.mutate(
      { restaurantId: order.restaurantId, orderId: order.id, tableNumber: tableInput.trim() },
      {
        onSuccess: () => setTableInput(''),
        onError: (e) => alertAsync({ title: 'Could not assign table', message: toFoodError(e).message }),
      },
    );
  };

  const onServed = () => order && markServed.mutate({ restaurantId: order.restaurantId, orderId: order.id }, { onError: (e) => alertAsync({ title: 'Could not update', message: toFoodError(e).message }) });
  const onClosed = () => order && markClosed.mutate({ restaurantId: order.restaurantId, orderId: order.id }, { onError: (e) => alertAsync({ title: 'Could not update', message: toFoodError(e).message }) });

  const advance = (next: OrderStatus) => {
    if (!order) return;
    setStatus.mutate(
      { restaurantId: order.restaurantId, orderId: order.id, status: next },
      { onError: (e) => alertAsync({ title: 'Could not update', message: toFoodError(e).message }) },
    );
  };

  // Secondary fallback only — the primary path is server auto-dispatch on 'ready'.
  const onAssign = () => {
    if (!order) return;
    assignRider.mutate(order.id, {
      onError: (e) => alertAsync({ title: 'Could not assign rider', message: toFoodError(e).message }),
    });
  };

  const onRedispatch = () => {
    if (!order) return;
    redispatch.mutate(order.id, {
      onError: (e) => alertAsync({ title: 'Could not re-dispatch', message: toFoodError(e).message }),
    });
  };

  const onReject = async () => {
    if (!order) return;
    const ok = await confirmAsync({ title: 'Reject order?', message: 'This cancels the order and refunds the customer.', confirmLabel: 'Reject', cancelLabel: 'Keep', destructive: true });
    if (ok) cancelOrder.mutate({ restaurantId: order.restaurantId, orderId: order.id });
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.topBar}>
        <Pressable onPress={() => goBack('/food/restaurant')} style={s.iconButton} accessibilityLabel="Go back">
          <Icons.ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={s.topTitle}>Manage order</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={s.iconButton}>{realtime.live ? <View style={s.liveDot} /> : null}</View>
          <HomeMenuButton />
        </View>
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
                <View style={s.badgeRow}>
                  <FoodStatusBadge status={status} />
                  {type !== 'delivery' ? (
                    <View style={s.typeBadge} testID="order-type-badge">
                      <Text style={s.typeBadgeText}>{ORDER_TYPE_LABEL[type]}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={s.headline}>{STATUS_LABEL[status]}</Text>
                {type === 'pickup_scheduled' && order.scheduledFor ? (
                  <Text style={s.addr}>Pickup slot: {new Date(order.scheduledFor).toLocaleString()}</Text>
                ) : null}
              </View>

              {type === 'dine_in' ? (
                <View style={[s.codeCard, shadow1]} testID="table-card">
                  <Text style={s.codeTitle}>Table</Text>
                  <Text style={s.codeValue}>{order.tableNumber ?? 'Unassigned'}</Text>
                </View>
              ) : null}

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
                {type === 'delivery' ? <Text style={s.addr}>Deliver to: {order.deliveryAddress}</Text> : null}
              </View>

              {/* Pickup code: hand this to the rider when they arrive — they must enter
                  it to confirm pickup. Distinct from the customer's delivery code. */}
              {usesRider(type) && normalizeStatus(status) === 'ready' && order.pickupCode ? (
                <View style={[s.codeCard, shadow1]}>
                  <View style={s.codeHead}>
                    <Icons.KeyRound size={18} color={Colors.tertiaryContainer} strokeWidth={2} />
                    <Text style={s.codeTitle}>Pickup code</Text>
                  </View>
                  <Text style={s.codeValue}>{order.pickupCode}</Text>
                  <Text style={s.codeHint}>Give this code to the rider when they arrive: {order.pickupCode}</Text>
                </View>
              ) : null}

              {/* Dispatch state — after 'ready' the server auto-dispatches riders. */}
              {usesRider(type) && normalizeStatus(status) === 'ready' && dispatchStatus && dispatchStatus !== 'none' ? (
                <View style={[s.dispatchCard, shadow1]}>
                  {dispatchStatus === 'searching' ? (
                    <Icons.Bike size={18} color={Colors.secondary} strokeWidth={2} />
                  ) : (
                    <Icons.CircleCheck size={18} color={Colors.tertiaryContainer} strokeWidth={2} />
                  )}
                  <Text style={s.dispatchText}>{DISPATCH_LABEL[dispatchStatus]}</Text>
                </View>
              ) : null}

              {usesRider(type) && order.rider ? (
                <View style={s.block}>
                  <RiderInfoCard rider={order.rider} />
                </View>
              ) : null}

              {acts?.canVerifyCode ? (
                <View style={[s.card, shadow1]}>
                  <Text style={s.cardTitle}>Verify customer code</Text>
                  <TextInput
                    value={verifyCode}
                    onChangeText={(t) => setVerifyCode(t.replace(/\D/g, '').slice(0, 8))}
                    keyboardType="number-pad"
                    placeholder="Customer's pickup code"
                    maxLength={8}
                    style={s.input}
                    testID="verify-code-input"
                    placeholderTextColor={Colors.onSurfaceVariant}
                  />
                  <PrimaryButton label="Verify customer code" onPress={onVerify} loading={verifyPickup.isPending} />
                </View>
              ) : null}

              {acts?.canAssignTable ? (
                <View style={[s.card, shadow1]}>
                  <Text style={s.cardTitle}>Assign table</Text>
                  <TextInput
                    value={tableInput}
                    onChangeText={setTableInput}
                    placeholder="Table number, e.g. 7"
                    maxLength={20}
                    style={s.input}
                    testID="table-input"
                    placeholderTextColor={Colors.onSurfaceVariant}
                  />
                  <PrimaryButton label="Assign table" variant="secondary" onPress={onAssignTable} loading={assignTable.isPending} disabled={!tableInput.trim()} />
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
                {status === 'preparing' && type !== 'dine_in' ? (
                  <PrimaryButton label={usesRider(type) ? 'Mark ready for pickup' : 'Mark ready for customer'} onPress={() => advance('ready')} loading={setStatus.isPending} />
                ) : null}
                {acts?.canServe ? <PrimaryButton label="Mark served" onPress={onServed} loading={markServed.isPending} /> : null}
                {acts?.canClose ? <PrimaryButton label="Close table" onPress={onClosed} loading={markClosed.isPending} /> : null}
                {/* After ready: auto-dispatch handles riders. Offer re-dispatch while still searching. */}
                {usesRider(type) && normalizeStatus(status) === 'ready' && !order.rider && dispatchStatus !== 'assigned' ? (
                  <PrimaryButton label="Re-dispatch to riders" onPress={onRedispatch} loading={redispatch.isPending} />
                ) : null}
                {/* Secondary fallback: manually assign a rider only if still unassigned. */}
                {usesRider(type) && normalizeStatus(status) === 'ready' && !order.rider ? (
                  <PrimaryButton label="Assign a rider manually" variant="secondary" onPress={onAssign} loading={assignRider.isPending} />
                ) : null}
                <PrimaryButton label={usesRider(type) ? 'Message customer & rider' : 'Message customer'} variant="secondary" onPress={() => setTab('chat')} />
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
  codeCard: { backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.md, alignItems: 'center', gap: 4 },
  codeHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  codeTitle: { ...Typography.labelLg, color: Colors.tertiaryContainer },
  codeValue: { ...Typography.headlineMd, color: Colors.tertiaryContainer, fontWeight: '800', letterSpacing: 6, marginVertical: 4 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  typeBadge: { backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 2 },
  typeBadgeText: { ...Typography.labelSm, color: Colors.white, fontWeight: '700' },
  input: { ...Typography.bodyMd, color: Colors.onSurface, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, borderRadius: Radius.lg, padding: Spacing.sm, marginBottom: Spacing.sm },
  codeHint: { ...Typography.bodySm, color: Colors.onSurface, textAlign: 'center' },
});
