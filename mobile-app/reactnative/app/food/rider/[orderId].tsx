import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import MobilityMap from '@/features/mobility/components/MobilityMap';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import {
  useOrder,
  useConfirmPickup,
  useConfirmHandoff,
  usePostRiderLocation,
} from '@/features/food/hooks';
import { useOrderRealtime } from '@/features/food/useOrderRealtime';
import { OrderChatThread, FoodStatusBadge } from '@/features/food/components';
import { formatNaira, STATUS_LABEL, isLiveTrackable, normalizeStatus, toFoodError } from '@/features/food/utils';

type Tab = 'delivery' | 'chat';

export default function RiderActiveDeliveryScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const [tab, setTab] = useState<Tab>('delivery');

  const [code, setCode] = useState('');
  const { data: order, isLoading, isError, refetch } = useOrder(orderId, { poll: true });
  const realtime = useOrderRealtime(orderId, { status: order?.status });
  const confirmPickup = useConfirmPickup();
  const confirmHandoff = useConfirmHandoff();
  const postLocation = usePostRiderLocation();

  const status = realtime.status ?? order?.status;
  const riderLocation = realtime.riderLocation ?? order?.rider?.location ?? null;

  // Heartbeat the rider's location while en route (drives the customer's live map).
  useEffect(() => {
    if (!order || !status || !isLiveTrackable(status)) return;
    const loc = order.rider?.location;
    if (!loc) return;
    const t = setInterval(() => {
      postLocation.mutate({ orderId: order.id, loc });
    }, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, status]);

  const onPickup = () => {
    if (!order) return;
    confirmPickup.mutate(order.id, {
      onError: (e) => Alert.alert('Could not confirm pickup', toFoodError(e).message),
    });
  };

  const onHandoff = () => {
    if (!order || code.trim().length < 4) return;
    confirmHandoff.mutate(
      { orderId: order.id, code: code.trim() },
      {
        onSuccess: () => setCode(''),
        onError: (e) => Alert.alert('Handoff failed', toFoodError(e).message),
      },
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.topBar}>
        <Pressable onPress={() => router.back()} style={s.iconButton} accessibilityLabel="Go back">
          <Icons.ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={s.topTitle}>Active delivery</Text>
        <View style={s.iconButton}>{realtime.live ? <View style={s.liveDot} /> : null}</View>
      </View>

      {isLoading ? (
        <StateView kind="loading" />
      ) : isError || !order || !status ? (
        <StateView kind="error" title="Couldn't load delivery" actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <>
          <View style={s.tabs}>
            {(['delivery', 'chat'] as Tab[]).map((t) => (
              <Pressable key={t} onPress={() => setTab(t)} style={[s.tab, tab === t && s.tabActive]}>
                <Text style={[s.tabLabel, tab === t && s.tabLabelActive]}>{t === 'delivery' ? 'Delivery' : 'Chat'}</Text>
              </Pressable>
            ))}
          </View>

          {tab === 'chat' ? (
            <OrderChatThread orderId={order.id} myRole="rider" orderStatus={status} />
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
              <View style={[s.statusCard, shadow1]}>
                <FoodStatusBadge status={status} />
                <Text style={s.headline}>{STATUS_LABEL[status]}</Text>
                <Text style={s.sub}>{order.restaurantName}</Text>
              </View>

              <View style={s.mapWrap}>
                <MobilityMap pickup={order.restaurantLocation} dropoff={order.deliveryLocation} driver={riderLocation} height={200} caption="Route" />
              </View>

              <View style={[s.card, shadow1]}>
                <View style={s.legRow}>
                  <Icons.Store size={16} color={Colors.secondary} strokeWidth={2} />
                  <Text style={s.legText}>Pickup: {order.restaurantName}</Text>
                </View>
                <View style={s.legRow}>
                  <Icons.MapPin size={16} color={Colors.primary} strokeWidth={2} />
                  <Text style={s.legText}>Drop-off: {order.deliveryAddress}</Text>
                </View>
                <View style={s.divider} />
                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>Order value</Text>
                  <Text style={s.totalValue}>{formatNaira(order.totalKobo)}</Text>
                </View>
              </View>

              <View style={s.actions}>
                {/* Step 1 — confirm pickup at the restaurant. */}
                {normalizeStatus(status) === 'assigned' || normalizeStatus(status) === 'ready' ? (
                  <PrimaryButton label="Confirm pickup" onPress={onPickup} loading={confirmPickup.isPending} />
                ) : null}

                {/* Step 2 — confirm handoff with the customer's delivery code. */}
                {status === 'picked_up' ? (
                  <View style={[s.handoffCard, shadow1]}>
                    <View style={s.handoffHead}>
                      <Icons.KeyRound size={18} color={Colors.secondary} strokeWidth={2} />
                      <Text style={s.handoffTitle}>Confirm handoff</Text>
                    </View>
                    <Text style={s.handoffHint}>Ask the customer for their 4-digit code.</Text>
                    <TextInput
                      style={s.codeInput}
                      value={code}
                      onChangeText={(t) => setCode(t.replace(/[^0-9]/g, '').slice(0, 4))}
                      placeholder="• • • •"
                      placeholderTextColor={Colors.onSurfaceVariant}
                      keyboardType="number-pad"
                      maxLength={4}
                      accessibilityLabel="Delivery code"
                    />
                    <PrimaryButton
                      label="Confirm handoff & complete"
                      onPress={onHandoff}
                      loading={confirmHandoff.isPending}
                      disabled={code.trim().length < 4}
                    />
                  </View>
                ) : null}

                {status === 'delivered' ? (
                  <View style={s.doneCard}>
                    <Icons.CircleCheck size={40} color={Colors.tertiaryContainer} strokeWidth={1.8} />
                    <Text style={s.done}>Delivery confirmed. Nice work!</Text>
                  </View>
                ) : null}
                <PrimaryButton label="Message customer & restaurant" variant="secondary" onPress={() => setTab('chat')} />
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
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  mapWrap: { marginTop: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginTop: Spacing.md, gap: Spacing.sm },
  legRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  legText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: Spacing.xs },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { ...Typography.labelLg, color: Colors.onSurface },
  totalValue: { ...Typography.titleMd, color: Colors.primary },
  actions: { marginTop: Spacing.lg, gap: Spacing.sm },
  done: { ...Typography.bodyMd, color: Colors.tertiaryContainer, textAlign: 'center', marginVertical: Spacing.sm },
  doneCard: { alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.md },
  handoffCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm },
  handoffHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  handoffTitle: { ...Typography.titleMd, color: Colors.onSurface },
  handoffHint: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  codeInput: {
    ...Typography.titleLg,
    color: Colors.onSurface,
    textAlign: 'center',
    letterSpacing: 8,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow,
  },
});
