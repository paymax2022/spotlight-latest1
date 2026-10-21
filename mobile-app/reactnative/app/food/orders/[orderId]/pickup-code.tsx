// Customer pickup / dine-in screen (FOOD-UAT-D-007): big pickup code, status,
// "I'm here" signal, and the dine-in table + progression.
import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { alertAsync } from '@/lib/confirm';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors, Radius, Spacing, Typography, shadow1 } from '@/constants/tokens';
import { useOrder, useSignalArrival } from '@/features/food/hooks';
import { useOrderRealtime } from '@/features/food/useOrderRealtime';
import { FoodStatusBadge } from '@/features/food/components';
import { toFoodError } from '@/features/food/utils';
import { canSignalArrival, fulfilmentHeadline, isPickup, orderTypeOf, ORDER_TYPE_LABEL } from '@/features/food/orderType';

const DINE_STEPS: { key: string; label: string }[] = [
  { key: 'preparing', label: 'Preparing' },
  { key: 'served', label: 'Served' },
  { key: 'closed', label: 'Closed' },
];

export default function PickupCodeScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { data: order, isLoading, isError, refetch } = useOrder(orderId, { poll: true });
  const realtime = useOrderRealtime(orderId, { status: order?.status });
  const arrive = useSignalArrival();

  if (isLoading) return <SafeAreaView style={s.safe}><StateView kind="loading" /></SafeAreaView>;
  if (isError || !order) {
    return <SafeAreaView style={s.safe}><StateView kind="error" title="Couldn't load order" actionLabel="Retry" onAction={() => refetch()} /></SafeAreaView>;
  }

  const type = orderTypeOf(order);
  const status = realtime.status ?? order.status;
  const live = { ...order, status };
  const pickup = isPickup(type);
  const dine = type === 'dine_in';

  const onArrive = () =>
    arrive.mutate(order.id, {
      onError: (e) => alertAsync({ title: "Couldn't notify the restaurant", message: toFoodError(e).message }),
    });

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.topBar}>
        <Text style={s.back} onPress={() => goBack('/food/orders')} accessibilityRole="button">Back</Text>
        <Text style={s.title}>{ORDER_TYPE_LABEL[type]}</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <View style={[s.card, shadow1]}>
          <FoodStatusBadge status={status} />
          <Text style={s.headline}>{fulfilmentHeadline(live)}</Text>
          {pickup && order.scheduledFor ? (
            <Text style={s.sub}>Pickup slot: {new Date(order.scheduledFor).toLocaleString()}</Text>
          ) : null}
          {pickup ? <Text style={s.sub}>{order.deliveryAddress ? `Pick up at: ${order.deliveryAddress}` : 'Collect from the restaurant counter.'}</Text> : null}
        </View>

        {pickup ? (
          <View style={[s.codeCard, shadow1]} testID="pickup-code-card">
            <Text style={s.codeTitle}>Your pickup code</Text>
            {order.pickupCode ? (
              <Text style={s.code} testID="pickup-code">{order.pickupCode}</Text>
            ) : (
              <Text style={s.sub}>Your code appears here once the restaurant starts your order.</Text>
            )}
            <Text style={s.sub}>Show this code at the counter to collect your food.</Text>
          </View>
        ) : null}

        {dine ? (
          <>
            <View style={[s.codeCard, shadow1]} testID="dine-table-card">
              <Text style={s.codeTitle}>{order.tableNumber ? 'Table assigned' : 'Table'}</Text>
              <Text style={s.code} testID="dine-table">{order.tableNumber ?? 'Pending'}</Text>
              {!order.tableNumber ? <Text style={s.sub}>The restaurant will assign your table when they accept.</Text> : null}
            </View>
            <View style={[s.card, shadow1]}>
              {DINE_STEPS.map((st, i) => {
                const idx = DINE_STEPS.findIndex((x) => x.key === status);
                const done = idx >= i || (status === 'closed');
                return (
                  <Text key={st.key} style={[s.step, done && s.stepDone]}>{done ? '● ' : '○ '}{st.label}</Text>
                );
              })}
            </View>
          </>
        ) : null}

        {pickup && order.arrivedAt ? (
          <Text style={s.sub} testID="arrived-ack">The restaurant knows you're here.</Text>
        ) : null}
        {canSignalArrival(live) ? (
          <PrimaryButton label="I'm here" onPress={onArrive} loading={arrive.isPending} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topBar: { height: 64, paddingHorizontal: Spacing.containerMargin, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { ...Typography.labelLg, color: Colors.primary },
  title: { ...Typography.titleLg, color: Colors.primary },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xxl },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: 6 },
  headline: { ...Typography.titleMd, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  codeCard: { backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.lg, alignItems: 'center', gap: 6 },
  codeTitle: { ...Typography.labelLg, color: Colors.tertiaryContainer },
  code: { ...Typography.headlineMd, fontSize: 44, lineHeight: 52, color: Colors.tertiaryContainer, fontWeight: '800', letterSpacing: 8 },
  step: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  stepDone: { color: Colors.tertiaryContainer, fontWeight: '700' },
});
