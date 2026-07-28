import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck, CircleAlert, Lock, PackageCheck, Truck, Package } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import PharmacyStatusPill from '@/features/health/components/PharmacyStatusPill';
import PharmacyOrderTimeline from '@/features/health/components/PharmacyOrderTimeline';
import { useOrder, useDispenseOrder, useHandoffOrder } from '@/features/health/pharmacy/hooks';
import { newIdempotencyKey } from '@/features/health/pharmacy/cartStore';
import { formatNaira } from '@/features/health/constants/health.constants';
import type { PharmacyOrder } from '@/features/health/pharmacy/types';

const PRE_DISPENSE: PharmacyOrder['status'][] = ['created', 'rx_pending', 'confirmed'];

export default function ProviderDispenseScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : Array.isArray(params.id) ? params.id[0] : undefined;

  const { data: order, isLoading, isError, refetch } = useOrder(id);
  const dispense = useDispenseOrder();
  const handoff = useHandoffOrder();

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Dispense & pack" />
        <StateView kind="loading" message="Loading order…" />
      </SafeAreaView>
    );
  }

  if (isError || !order) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Dispense & pack" />
        <StateView kind="error" title="Couldn't load order" message="Please try again." actionLabel="Retry" onAction={refetch} />
      </SafeAreaView>
    );
  }

  const awaitingRx = order.requiresRx && !order.rxId;
  const isPreDispense = PRE_DISPENSE.includes(order.status);
  const isDispensed = order.status === 'dispensed';

  const onDispense = async () => {
    await dispense.mutateAsync({ orderId: order.id, idempotencyKey: newIdempotencyKey('dispense') });
  };

  const onHandoff = async () => {
    const mode = order.fulfilment === 'delivery' ? 'dispatch' : 'pickup';
    await handoff.mutateAsync({ orderId: order.id, mode, idempotencyKey: newIdempotencyKey('handoff') });
    router.replace({ pathname: '/health/pharmacy/provider/handoff', params: { id: order.id } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Dispense & pack" subtitle={order.reference} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.statusRow}>
          <PharmacyStatusPill order={order.status} />
          <View style={styles.fulfilTag}>
            {order.fulfilment === 'delivery' ? (
              <Truck size={13} color={Colors.secondary} strokeWidth={2.2} />
            ) : (
              <Package size={13} color={Colors.teal} strokeWidth={2.2} />
            )}
            <Text style={styles.fulfilText}>{order.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}</Text>
          </View>
        </View>

        {/* Rx attachment banner */}
        {order.requiresRx ? (
          awaitingRx ? (
            <View style={[styles.banner, styles.bannerWarn]}>
              <CircleAlert size={16} color={Colors.onWarning} strokeWidth={2} />
              <Text style={[styles.bannerText, { color: Colors.onWarning }]}>
                Awaiting Rx verification. This order cannot be dispensed until a verified prescription is attached (HL-3).
              </Text>
            </View>
          ) : (
            <View style={[styles.banner, styles.bannerOk]}>
              <ShieldCheck size={16} color={Colors.teal} strokeWidth={2} />
              <Text style={[styles.bannerText, { color: Colors.tertiaryContainer }]}>
                Verified Rx attached. Dispense-once applies (HL-3).
              </Text>
            </View>
          )
        ) : null}

        {/* Order summary */}
        <Text style={styles.sectionTitle}>Order summary</Text>
        <View style={[styles.summary, shadow1]}>
          {order.lines.map((l) => (
            <View key={l.productId} style={styles.sumRow}>
              <Text style={styles.sumName} numberOfLines={1}>{l.qty} × {l.name}</Text>
              <Text style={styles.sumVal}>{formatNaira(l.priceKobo * l.qty)}</Text>
            </View>
          ))}
          <View style={styles.divider} />
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>Subtotal</Text>
            <Text style={styles.sumVal}>{formatNaira(order.subtotalKobo)}</Text>
          </View>
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>Delivery</Text>
            <Text style={styles.sumVal}>{order.deliveryFeeKobo ? formatNaira(order.deliveryFeeKobo) : 'Free'}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.sumRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalVal}>{formatNaira(order.totalKobo)}</Text>
          </View>
        </View>

        {/* Timeline */}
        <Text style={styles.sectionTitle}>Progress</Text>
        <View style={[styles.timelineCard, shadow1]}>
          <PharmacyOrderTimeline events={order.timeline} />
        </View>

        {/* HL-9 payment-held strip */}
        <View style={[styles.banner, styles.bannerOk]}>
          <Lock size={16} color={Colors.teal} strokeWidth={2} />
          <Text style={[styles.bannerText, { color: Colors.tertiaryContainer }]}>
            Payment is held in escrow and released to you once the order is delivered or collected (HL-9).
          </Text>
        </View>
      </ScrollView>

      {/* Footer actions */}
      {isPreDispense ? (
        <View style={styles.footer}>
          <PrimaryButton
            label="Mark dispensed & packed"
            onPress={onDispense}
            loading={dispense.isPending}
            disabled={awaitingRx}
          />
        </View>
      ) : isDispensed ? (
        <View style={styles.footer}>
          <PrimaryButton
            label={order.fulfilment === 'delivery' ? 'Hand off to delivery' : 'Mark ready for pickup'}
            onPress={onHandoff}
            loading={handoff.isPending}
          />
        </View>
      ) : (
        <View style={styles.footer}>
          <View style={styles.doneRow}>
            <PackageCheck size={16} color={Colors.teal} strokeWidth={2} />
            <Text style={styles.doneText}>This order has been handed off.</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  fulfilTag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceContainerLow, paddingHorizontal: Spacing.sm + 2, paddingVertical: 5, borderRadius: Radius.full },
  fulfilText: { ...Typography.labelSm, fontWeight: '700' as const, color: Colors.onSurface },
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, borderRadius: Radius.md, padding: Spacing.md },
  bannerOk: { backgroundColor: Colors.iconBgTeal },
  bannerWarn: { backgroundColor: Colors.iconBgGold },
  bannerText: { ...Typography.bodySm, flex: 1, lineHeight: 18 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  summary: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sumName: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1, marginRight: Spacing.sm },
  sumLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  sumVal: { ...Typography.bodyMd, color: Colors.onSurface },
  totalLabel: { ...Typography.titleMd, color: Colors.onSurface },
  totalVal: { ...Typography.titleMd, color: Colors.primary },
  divider: { height: 1, backgroundColor: Colors.outlineVariant },
  timelineCard: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
  doneRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  doneText: { ...Typography.labelLg, color: Colors.onSurfaceVariant },
});
