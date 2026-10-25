import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Truck, Package, ShieldCheck, MapPin, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import AddressAutocompleteInput, { type SelectedAddress } from '@/components/AddressAutocompleteInput';
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
  // HL-3: any Rx-required order must carry a prescription reference, and the server
  // then routes it through the pharmacist (RX_PENDING_VERIFICATION). An e-Rx that is
  // still being verified is therefore a valid attachment — accept either state — but
  // one that has not been sent to a pharmacy at all is not, because there would be
  // nothing for the pharmacist to confirm against.
  const attachableRx = (prescriptions ?? []).find((r) => r.status === 'verified' || r.status === 'verifying');

  const [fulfilment, setFulfilment] = useState<FulfilmentType>(
    pharmacy?.supportsDelivery ? 'delivery' : 'pickup',
  );
  // Delivery dropoff — the backend requires an address + real coordinates for a
  // be a hardcoded fixture string ("12B Ozumba Mbadiwe Ave..."), which meant a
  // real request would either be silently wrong or (now that the backend
  // validates it, see CreateOrder in service.go) rejected outright.
  const [deliveryAddrText, setDeliveryAddrText] = useState('');
  const [deliveryAddr, setDeliveryAddr] = useState<SelectedAddress | null>(null);
  const addressResolved = fulfilment !== 'delivery' || Boolean(deliveryAddr);

  // The courier's fare is NOT part of this hold. CreateOrder prices the order at
  // Σ(price × qty) and escrow holds exactly that; delivery_fee_kobo is the pharmacy's
  // own transport setting, settled as a separate money event. Adding it here made the
  // checkout promise (and charge, on the card rail) more than the order ever holds.
  const totalKobo = cart.subtotalKobo;
  const riderFareKobo = fulfilment === 'delivery' ? pharmacy?.deliveryFeeKobo ?? 0 : 0;

  if (lines.length === 0 || !pharmacy) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Checkout" />
        <StateView
          kind="empty"
          icon="ShoppingCart"
          title={lines.length === 0 ? 'Nothing to check out' : 'This pharmacy isn’t available'}
          message={
            lines.length === 0
              ? 'Add items and pick a pharmacy first.'
              : 'The pharmacy selling your items is not accepting orders right now. Remove its items and choose another.'
          }
          actionLabel="Browse medicines"
          onAction={() => router.replace('/health/pharmacy/search')}
        />
      </SafeAreaView>
    );
  }

  const onPay = () => {
    if (!addressResolved || (cart.requiresRx && !attachableRx)) return;
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
          rxId: cart.requiresRx ? attachableRx?.id : undefined,
          idempotencyKey,
          searchEventId: useSymptomSearchStore.getState().searchEventId ?? undefined,
          deliveryAddress: fulfilment === 'delivery' ? deliveryAddr?.label : undefined,
          deliveryLat: fulfilment === 'delivery' ? deliveryAddr?.lat : undefined,
          deliveryLng: fulfilment === 'delivery' ? deliveryAddr?.lng : undefined,
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
        {fulfilment === 'delivery' ? (
          <View>
            <Text style={styles.addrLabel}>Deliver to</Text>
            <AddressAutocompleteInput
              value={deliveryAddrText}
              onChangeText={(t) => {
                setDeliveryAddrText(t);
                setDeliveryAddr(null); // typed text no longer matches a geocoded pick
              }}
              onSelect={(a: SelectedAddress) => {
                setDeliveryAddrText(a.label);
                setDeliveryAddr(a);
              }}
              resolved={Boolean(deliveryAddr)}
              surface="delivery"
              placeholder="Search your delivery address…"
            />
          </View>
        ) : (
          <View style={[styles.addr, shadow1]}>
            <MapPin size={18} color={Colors.secondary} strokeWidth={2} />
            <View style={{ flex: 1 }}>
              <Text style={styles.addrLabel}>Pick up from</Text>
              <Text style={styles.addrValue} numberOfLines={2}>{pharmacy.address}</Text>
            </View>
          </View>
        )}

        {/* Rx attachment (HL-3) */}
        {cart.requiresRx ? (
          <View style={styles.rxAttach}>
            <ShieldCheck size={16} color={attachableRx ? Colors.teal : Colors.onWarning} strokeWidth={2} />
            <Text style={styles.rxAttachText}>
              {attachableRx?.status === 'verified'
                ? 'Verified prescription attached to this order.'
                : attachableRx
                ? 'Your e-Rx is with a pharmacist — the order confirms once they verify it.'
                : 'This order needs a prescription that has been sent to a pharmacy.'}
            </Text>
            {!attachableRx ? (
              <Pressable onPress={() => router.push('/health/pharmacy/send-rx')}>
                <Text style={styles.rxAttachLink}>Send an e-Rx</Text>
              </Pressable>
            ) : null}
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
            <Text style={styles.sumLabel}>Rider’s fare</Text>
            <Text style={styles.sumVal}>{riderFareKobo ? `${formatNaira(riderFareKobo)} separately` : 'Free'}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.sumRow}>
            <Text style={styles.totalLabel}>Held with this order</Text>
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
          label={
            !addressResolved
              ? 'Select a delivery address'
              : cart.requiresRx && !attachableRx
              ? 'A prescription is required'
              : `Pay & hold ${formatNaira(totalKobo)}`
          }
          onPress={onPay}
          loading={createOrder.isPending}
          disabled={!addressResolved || (cart.requiresRx && !attachableRx)}
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
  rxAttachLink: { ...Typography.labelMd, color: Colors.secondary },
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
