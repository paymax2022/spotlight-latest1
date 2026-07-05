import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { MapPin, Lock, Store } from 'lucide-react-native';
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

export default function PickupCodeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: order, isLoading, isError, refetch } = useOrder(id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Pickup code" />

      {isLoading ? (
        <StateView kind="loading" message="Loading your order…" />
      ) : isError || !order ? (
        <StateView kind="error" title="Couldn't load order" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.statusRow}>
              <PharmacyStatusPill order={order.status} />
            </View>

            <Text style={styles.title}>Show this at the counter</Text>
            <Text style={styles.sub}>
              The pharmacist will scan your QR or enter the code to release {order.reference}.
            </Text>

            {/* QR */}
            <View style={styles.qrWrap}>
              <QrCodeView payload={`paymax-pharmacy:${order.reference}:${order.pickupCode ?? ''}`} size={200} />
            </View>

            {/* Code */}
            <View style={[styles.codeCard, shadow1]}>
              <Text style={styles.codeLabel}>Pickup code</Text>
              <Text style={styles.code}>{order.pickupCode ?? '----'}</Text>
            </View>

            {/* Pharmacy */}
            <View style={[styles.pharmacy, shadow1]}>
              <View style={styles.storeIcon}>
                <Store size={20} color={Colors.primary} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.pharmacyName}>{order.pharmacyName}</Text>
                <View style={styles.addrRow}>
                  <MapPin size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
                  <Text style={styles.addr}>Ready for pickup · {order.etaLabel ?? '~30 min'}</Text>
                </View>
              </View>
            </View>

            {/* Payment held (HL-9) */}
            {order.paymentHeld ? (
              <View style={styles.held}>
                <Lock size={15} color={Colors.teal} strokeWidth={2} />
                <Text style={styles.heldText}>
                  {formatNaira(order.totalKobo)} is held and released to the pharmacy once you collect.
                </Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton label="View my orders" variant="secondary" onPress={() => router.push('/health/pharmacy/orders')} />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, alignItems: 'center', paddingBottom: 40 },
  statusRow: { alignSelf: 'flex-start' },
  title: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 19, paddingHorizontal: Spacing.md },
  qrWrap: { marginVertical: Spacing.sm },
  codeCard: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 4,
  },
  codeLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 1 },
  code: { ...Typography.displayLg, fontSize: 40, lineHeight: 46, color: Colors.primary, letterSpacing: 8 },
  pharmacy: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  storeIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pharmacyName: { ...Typography.labelLg, color: Colors.onSurface },
  addrRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  addr: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  held: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  heldText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  footer: { width: '100%', padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
