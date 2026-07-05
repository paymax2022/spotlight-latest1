import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Map, Phone, MessageCircle, Bike, Lock } from 'lucide-react-native';
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
import { useOrder } from '@/features/health/pharmacy/hooks';
import { formatNaira } from '@/features/health/constants/health.constants';

export default function DeliveryTrackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: order, isLoading, isError, refetch } = useOrder(id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Track delivery" />

      {isLoading ? (
        <StateView kind="loading" message="Loading your order…" />
      ) : isError || !order ? (
        <StateView kind="error" title="Couldn't load order" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {/* Map placeholder + ETA */}
            <View style={styles.map}>
              <Map size={28} color={Colors.secondary} strokeWidth={1.6} />
              <Text style={styles.eta}>{order.etaLabel ?? 'On the way'}</Text>
            </View>

            {/* Status */}
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.ref}>Order {order.reference}</Text>
                <Text style={styles.pharmacy}>{order.pharmacyName}</Text>
              </View>
              <PharmacyStatusPill order={order.status} />
            </View>

            {/* Rider */}
            {order.rider ? (
              <View style={[styles.rider, shadow1]}>
                <View style={styles.riderIcon}>
                  <Bike size={20} color={Colors.primary} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.riderName}>{order.rider.name}</Text>
                  <Text style={styles.riderSub}>{order.rider.vehicle}</Text>
                </View>
                <Pressable style={styles.iconBtn} onPress={() => Linking.openURL(`tel:${order.rider?.phone}`)}>
                  <Phone size={18} color={Colors.secondary} strokeWidth={2} />
                </Pressable>
                <Pressable style={styles.iconBtn} onPress={() => router.push('/health/pharmacy/pharmacist-consult')}>
                  <MessageCircle size={18} color={Colors.secondary} strokeWidth={2} />
                </Pressable>
              </View>
            ) : null}

            {/* Timeline */}
            <View style={[styles.card, shadow1]}>
              <Text style={styles.cardTitle}>Progress</Text>
              <PharmacyOrderTimeline events={order.timeline} />
            </View>

            {/* Payment held (HL-9) */}
            {order.paymentHeld ? (
              <View style={styles.held}>
                <Lock size={15} color={Colors.teal} strokeWidth={2} />
                <Text style={styles.heldText}>
                  {formatNaira(order.totalKobo)} is held and will be released to {order.pharmacyName} once delivered.
                </Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton label="View order details" variant="secondary" onPress={() => router.push('/health/pharmacy/orders')} />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  map: {
    height: 160,
    backgroundColor: Colors.surfaceContainerHigh,
    borderRadius: Radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  eta: { ...Typography.titleMd, color: Colors.onSurface },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ref: { ...Typography.titleMd, color: Colors.onSurface },
  pharmacy: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  rider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  riderIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  riderName: { ...Typography.labelLg, color: Colors.onSurface },
  riderSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  held: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  heldText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
