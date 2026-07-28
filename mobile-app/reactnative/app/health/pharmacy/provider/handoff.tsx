import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Truck, Navigation, Phone, Map, PackageCheck, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import QrCodeView from '@/components/QrCodeView';
import PharmacyStatusPill from '@/features/health/components/PharmacyStatusPill';
import { useOrder } from '@/features/health/pharmacy/hooks';
import { formatNaira } from '@/features/health/constants/health.constants';

export default function HandoffScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { data: order, isLoading, isError, refetch } = useOrder(id);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Order handoff" />
        <StateView kind="loading" message="Loading order…" />
      </SafeAreaView>
    );
  }

  if (isError || !order) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Order handoff" />
        <StateView kind="error" title="Couldn't load order" message="Please try again." actionLabel="Retry" onAction={refetch} />
      </SafeAreaView>
    );
  }

  const isPickup = order.fulfilment === 'pickup';
  const itemCount = order.lines.reduce((s, l) => s + l.qty, 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Order handoff" subtitle={order.reference} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Status + summary */}
        <View style={[styles.card, shadow1]}>
          <View style={styles.row}>
            <Text style={styles.ref}>{order.reference}</Text>
            <PharmacyStatusPill order={order.status} />
          </View>
          <Text style={styles.summary}>
            {itemCount} {itemCount === 1 ? 'item' : 'items'} · {formatNaira(order.totalKobo)}
          </Text>
        </View>

        {isPickup ? (
          /* ── Pickup handoff ── */
          <View style={[styles.card, styles.center, shadow1]}>
            <View style={[styles.iconBox, { backgroundColor: Colors.iconBgTeal }]}>
              <PackageCheck size={22} color={Colors.teal} strokeWidth={2} />
            </View>
            <Text style={styles.cardTitle}>Ready for pickup</Text>
            <Text style={styles.pickupLabel}>Pickup code</Text>
            <Text style={styles.pickupCode}>{order.pickupCode ?? '——'}</Text>
            <QrCodeView payload={`paymax-pharmacy:${order.reference}:${order.pickupCode ?? ''}`} size={180} />
            <Text style={styles.helper}>
              Order is ready for pickup. Customer presents this code/QR at the counter.
            </Text>
          </View>
        ) : (
          /* ── Delivery handoff ── */
          <>
            <View style={[styles.card, shadow1]}>
              <View style={styles.cardHead}>
                <View style={[styles.iconBox, { backgroundColor: Colors.iconBgTeal }]}>
                  <Truck size={20} color={Colors.teal} strokeWidth={2} />
                </View>
                <Text style={styles.cardTitle}>Handed to rider</Text>
              </View>
              {order.rider ? (
                <View style={styles.riderBox}>
                  <Text style={styles.riderName}>{order.rider.name}</Text>
                  <Text style={styles.riderMeta}>{order.rider.vehicle}</Text>
                  <View style={styles.riderPhone}>
                    <Phone size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
                    <Text style={styles.riderPhoneText}>{order.rider.phone}</Text>
                  </View>
                </View>
              ) : (
                <Text style={styles.helper}>A rider will be assigned shortly.</Text>
              )}
            </View>

            <View style={[styles.card, shadow1]}>
              <View style={styles.cardHead}>
                <View style={[styles.iconBox, { backgroundColor: Colors.iconBgBlue }]}>
                  <Navigation size={20} color={Colors.secondary} strokeWidth={2} />
                </View>
                <Text style={styles.cardTitle}>On the delivery rail</Text>
              </View>
              <View style={styles.mapPlaceholder}>
                <Map size={28} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
                <Text style={styles.mapText}>Routing on the last-mile rail</Text>
              </View>
            </View>
          </>
        )}

        {/* HL-9 strip */}
        <View style={styles.hlStrip}>
          <Lock size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.hlText}>Payment is released once the order is delivered/collected.</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Back to orders" onPress={() => router.replace('/health/pharmacy/provider/orders')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  center: { alignItems: 'center', gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ref: { ...Typography.labelLg, color: Colors.onSurface },
  summary: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...Typography.titleMd, fontSize: 16, color: Colors.onSurface },
  pickupLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  pickupCode: { ...Typography.headlineMd, color: Colors.primary, letterSpacing: 4 },
  helper: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 19 },
  riderBox: { gap: 3, paddingTop: Spacing.xs },
  riderName: { ...Typography.labelLg, color: Colors.onSurface },
  riderMeta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  riderPhone: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  riderPhoneText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  mapPlaceholder: {
    height: 140,
    backgroundColor: Colors.surfaceContainerHigh,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  mapText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  hlStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
  },
  hlText: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1 },
  footer: {
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
    padding: Spacing.containerMargin,
  },
});
