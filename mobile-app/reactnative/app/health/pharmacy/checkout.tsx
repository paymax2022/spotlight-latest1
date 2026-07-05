import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Truck, Package, ShieldCheck, MapPin, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { PaymentSheet, usePurchasePayment } from '@/features/payments';
import { useCartStore, newIdempotencyKey } from '@/features/health/pharmacy/cartStore';
import { useSymptomSearchStore } from '@/features/health/pharmacy/symptomSearchStore';
import { usePharmacies, useCreateOrder, usePrescriptions } from '@/features/health/pharmacy/hooks';
import { formatNaira } from '@/features/health/constants/health.constants';
import { PAYMENT_HELD_COPY } from '@/features/health/pharmacy/constants';
import type { FulfilmentType, PharmacyOrder } from '@/features/health/pharmacy/types';

export default function CheckoutScreen() {
  const lines = useCartStore((s) => s.lines);
  const cart = useCartStore((s) => s.cart());
  const pharmacyId = useCartStore((s) => s.pharmacyId);
  const clear = useCartStore((s) => s.clear);
  const { data: pharmacies } = usePharmacies();
  const { data: prescriptions } = usePrescriptions();
  const createOrder = useCreateOrder();
  const pay = usePurchasePayment<PharmacyOrder>();

  const pharmacy = useMemo(() => (pharmacies ?? []).find((p) => p.id === pharmacyId), [pharmacies, pharmacyId]);
  const verifiedRx = (prescriptions ?? []).find((r) => r.status === 'verified');

  const [fulfilment, setFulfilment] = useState<FulfilmentType>(
    pharmacy?.supportsDelivery ? 'delivery' : 'pickup',
  );

  const deliveryFeeKobo = fulfilment === 'delivery' ? pharmacy?.deliveryFeeKobo ?? 0 : 0;
  const totalKobo = cart.subtotalKobo + deliveryFeeKobo;

  if (lines.length === 0 || !pharmacy) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Checkout" />
        <StateView
          kind="empty"
          icon="ShoppingCart"
          title="Nothing to check out"
          message="Add items and pick a pharmacy first."
          actionLabel="Browse medicines"
          onAction={() => router.replace('/health/pharmacy/search')}
        />
      </SafeAreaView>
    );
  }

  const onPay = () => {
    const idempotencyKey = newIdempotencyKey('order');
    pay.start({
      amountKobo: totalKobo,
      title: 'Pay & hold for your order',
      charge: async () => {
        // HL-9: held payment captured on order create; Idempotency-Key guards it.
        // Links the order to the symptom-search context when one is active
        // (T1 auto-clears; T2+ opens a pharmacist review case).
        return createOrder.mutateAsync({
          pharmacyId: pharmacy.id,
          fulfilment,
          lines,
          rxId: cart.requiresRx ? verifiedRx?.id : undefined,
          idempotencyKey,
          searchEventId: useSymptomSearchStore.getState().searchEventId ?? undefined,
        });
      },
      onPaid: (order) => {
        clear();
        // One search context per order — consumed, so clear it.
        useSymptomSearchStore.getState().setSearchEventId(null);
        if (fulfilment === 'delivery') {
          router.replace({ pathname: '/health/pharmacy/delivery-tracking', params: { id: order.id } });
        } else {
          router.replace({ pathname: '/health/pharmacy/pickup-code', params: { id: order.id } });
        }
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Checkout" subtitle={pharmacy.name} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Fulfilment toggle */}
        <Text style={styles.sectionTitle}>Fulfilment</Text>
        <View style={styles.fulfilRow}>
          {pharmacy.supportsDelivery ? (
            <Pressable
              style={[styles.fulfil, fulfilment === 'delivery' && styles.fulfilSel]}
              onPress={() => setFulfilment('delivery')}
            >
              <Truck size={20} color={fulfilment === 'delivery' ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={[styles.fulfilLabel, fulfilment === 'delivery' && styles.fulfilLabelSel]}>Delivery</Text>
              <Text style={styles.fulfilSub}>{pharmacy.etaLabel}</Text>
            </Pressable>
          ) : null}
          {pharmacy.supportsPickup ? (
            <Pressable
              style={[styles.fulfil, fulfilment === 'pickup' && styles.fulfilSel]}
              onPress={() => setFulfilment('pickup')}
            >
              <Package size={20} color={fulfilment === 'pickup' ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={[styles.fulfilLabel, fulfilment === 'pickup' && styles.fulfilLabelSel]}>Pickup</Text>
              <Text style={styles.fulfilSub}>Free · ~30 min</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Address / pickup location */}
        <View style={[styles.addr, shadow1]}>
          <MapPin size={18} color={Colors.secondary} strokeWidth={2} />
          <View style={{ flex: 1 }}>
            <Text style={styles.addrLabel}>{fulfilment === 'delivery' ? 'Deliver to' : 'Pick up from'}</Text>
            <Text style={styles.addrValue} numberOfLines={2}>
              {fulfilment === 'delivery' ? '12B Ozumba Mbadiwe Ave, Victoria Island, Lagos' : pharmacy.address}
            </Text>
          </View>
        </View>

        {/* Rx attachment (HL-3) */}
        {cart.requiresRx ? (
          <View style={styles.rxAttach}>
            <ShieldCheck size={16} color={Colors.teal} strokeWidth={2} />
            <Text style={styles.rxAttachText}>
              {verifiedRx
                ? 'Verified prescription attached to this order.'
                : 'A verified prescription is required before dispensing.'}
            </Text>
          </View>
        ) : null}

        {/* Order summary */}
        <Text style={styles.sectionTitle}>Order summary</Text>
        <View style={[styles.summary, shadow1]}>
          {lines.map((l) => (
            <View key={l.productId} style={styles.sumRow}>
              <Text style={styles.sumName} numberOfLines={1}>
                {l.qty} × {l.name}
              </Text>
              <Text style={styles.sumVal}>{formatNaira(l.priceKobo * l.qty)}</Text>
            </View>
          ))}
          <View style={styles.divider} />
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>Subtotal</Text>
            <Text style={styles.sumVal}>{formatNaira(cart.subtotalKobo)}</Text>
          </View>
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>Delivery</Text>
            <Text style={styles.sumVal}>{deliveryFeeKobo ? formatNaira(deliveryFeeKobo) : 'Free'}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.sumRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalVal}>{formatNaira(totalKobo)}</Text>
          </View>
        </View>

        {/* HL-9 payment-held messaging */}
        <View style={styles.held}>
          <Lock size={16} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.heldText}>{PAYMENT_HELD_COPY}</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={`Pay & hold ${formatNaira(totalKobo)}`}
          onPress={onPay}
          loading={createOrder.isPending}
        />
      </View>

      <PaymentSheet controller={pay} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  fulfilRow: { flexDirection: 'row', gap: Spacing.md },
  fulfil: {
    flex: 1,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 4,
  },
  fulfilSel: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  fulfilLabel: { ...Typography.labelLg, color: Colors.onSurfaceVariant },
  fulfilLabelSel: { color: Colors.onSurface },
  fulfilSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  addr: {
    flexDirection: 'row',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  addrLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  addrValue: { ...Typography.bodyMd, color: Colors.onSurface, marginTop: 1 },
  rxAttach: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  rxAttachText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
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
