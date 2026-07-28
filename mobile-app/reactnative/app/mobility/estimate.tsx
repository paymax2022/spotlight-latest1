import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Zap, HandCoins, Wallet, CreditCard, Banknote, Check, MapPin, LocateFixed, Pencil, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import MobilityMap from '@/features/mobility/components/MobilityMap';
import TripRouteCard from '@/features/mobility/components/TripRouteCard';
import ServiceTypeCard from '@/features/mobility/components/ServiceTypeCard';
import FareOfferSheet from '@/features/mobility/components/FareOfferSheet';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import AddressEntry, { type ConfirmedAddress } from '@/features/mobility/components/AddressEntry';
import { useRideEstimate, useRideRequest } from '@/features/mobility/hooks/useMobility';
import { useCurrentLocation } from '@/features/location/useCurrentLocation';
import { usePurchasePayment, PaymentSheet } from '@/features/payments';
import { SERVICE_TYPES, RIDE_NEGOTIATION_ENABLED } from '@/features/mobility/constants/mobility.constants';
import { toMobilityError, isNoDriverError, isFareBoundError, fareBoundMessage, formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import type { ServiceType, PricingMode, PaymentMethod, Place, RideEstimate, Trip } from '@/features/mobility/types/mobility.types';

// Only used when location permission is denied or expo-location is unavailable —
// the rider can still edit the pickup via the address picker.
const FALLBACK_PICKUP: Place = { address: '14 Admiralty Way, Lekki Phase 1', lat: 6.4459, lng: 3.4730, label: 'Set pickup location' };

const PAYMENT_METHODS: { value: PaymentMethod; label: string; icon: typeof Wallet }[] = [
  { value: 'wallet', label: 'Paymax wallet', icon: Wallet },
  { value: 'card', label: 'Card', icon: CreditCard },
  { value: 'cash', label: 'Cash', icon: Banknote },
];

export default function EstimateScreen() {
  const params = useLocalSearchParams<{
    destAddress?: string; lat?: string; lng?: string; serviceType?: string;
    pickupAddress?: string; pickupLat?: string; pickupLng?: string;
  }>();

  // Destination starts from the planner params but is editable on this screen.
  const [dest, setDest] = useState<Place>(() => ({
    address: params.destAddress ?? 'Plot 5, Idejo St, Victoria Island',
    lat: params.lat ? Number(params.lat) : 6.4281,
    lng: params.lng ? Number(params.lng) : 3.4219,
  }));
  const [editingDest, setEditingDest] = useState(false);

  // Pickup can be set explicitly on the mobility home ("Current location"); when
  // passed it takes precedence over GPS auto-detect below.
  const pickupFromParams: Place | null = useMemo(
    () =>
      params.pickupAddress
        ? {
            address: String(params.pickupAddress),
            lat: params.pickupLat ? Number(params.pickupLat) : FALLBACK_PICKUP.lat,
            lng: params.pickupLng ? Number(params.pickupLng) : FALLBACK_PICKUP.lng,
            label: 'Current location',
          }
        : null,
    [params.pickupAddress, params.pickupLat, params.pickupLng],
  );

  // Reuse-a-ride: history can pass the original ride class so the rebooked trip
  // starts on the same tier. Validate against the known set before trusting it.
  const initialService: ServiceType = SERVICE_TYPES.some((s) => s.value === params.serviceType)
    ? (params.serviceType as ServiceType)
    : 'economy';
  const [serviceType, setServiceType] = useState<ServiceType>(initialService);
  const [pricingMode, setPricingMode] = useState<PricingMode>('instant');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('wallet');
  const [offerKobo, setOfferKobo] = useState<number>(0);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Pickup: explicit "Current location" from the planner if present, else real
  // device location (GPS + reverse geocode) with graceful fallback.
  const [pickup, setPickup] = useState<Place>(pickupFromParams ?? FALLBACK_PICKUP);
  const [pickupResolved, setPickupResolved] = useState(Boolean(pickupFromParams));
  const [editingPickup, setEditingPickup] = useState(false);
  // True when the pickup was explicitly stated by the rider (planner or manual
  // edit) rather than auto-detected via GPS — drives the pin icon/label so the
  // screen never implies "current location" for a hand-entered address.
  const [pickupIsManual, setPickupIsManual] = useState(Boolean(pickupFromParams));
  const location = useCurrentLocation();

  const estimate = useRideEstimate();
  const request = useRideRequest();
  const est: RideEstimate | undefined = estimate.data;
  // Shared wallet/card chooser — gates the wallet debit exactly like carhire/bus.
  const pay = usePurchasePayment<Trip>();

  // On mount, try to capture the device's current location as the pickup.
  // When GPS is unavailable or denied, do NOT silently keep the fallback
  // address — open the pickup entry so the rider types a real one.
  useEffect(() => {
    // An explicit pickup was passed from the "Current location" field — respect
    // it and skip GPS auto-detect entirely.
    if (pickupFromParams) return;
    let cancelled = false;
    (async () => {
      if (!location.available) {
        if (!cancelled) setEditingPickup(true); // no GPS module (e.g. web) → ask
        return;
      }
      const resolved = await location.getCurrent();
      if (cancelled) return;
      if (!resolved) {
        setEditingPickup(true); // permission denied / lookup failed → ask
        return;
      }
      setPickup({ address: resolved.label, lat: resolved.lat, lng: resolved.lng, label: 'Current location' });
      setPickupResolved(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPickupConfirmed = useCallback((addr: ConfirmedAddress) => {
    setPickup({ address: addr.addressLabel, lat: addr.lat, lng: addr.lng, label: 'Pickup' });
    setPickupResolved(true);
    setPickupIsManual(true); // rider stated this pickup — not GPS
    setEditingPickup(false);
  }, []);

  const onDestConfirmed = useCallback((addr: ConfirmedAddress) => {
    setDest({ address: addr.addressLabel, lat: addr.lat, lng: addr.lng });
    setEditingDest(false);
  }, []);

  // Fetch estimate whenever the service type or pickup changes.
  useEffect(() => {
    setSubmitError(null);
    estimate.mutate(
      { pickup, dest, serviceType },
      { onSuccess: (e) => setOfferKobo(e.systemFareKobo) },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceType, dest, pickup]);

  // Fire the ride request (the server-side wallet debit / escrow). Called either
  // directly (cash) or as the PaymentSheet's `charge` (wallet/card).
  const submitRide = (method: PaymentMethod) =>
    request.mutateAsync({
      pickup,
      dest,
      serviceType,
      pricingMode,
      offerKobo: pricingMode === 'offer' ? offerKobo : undefined,
      paymentMethod: method,
    });

  const onRideCreated = (trip: Trip) => {
    if (trip.phase === 'fare_negotiating') router.replace(`/mobility/trip/${trip.id}`);
    else router.replace(`/mobility/searching?tripId=${trip.id}`);
  };

  const onRideError = (e: unknown) => {
    const me = toMobilityError(e);
    if (isFareBoundError(me)) setSubmitError(fareBoundMessage(me, est?.offerMinKobo ?? 0, est?.offerMaxKobo ?? 0));
    else if (isNoDriverError(me)) setSubmitError(null); // handled on next screen
    else if (me.code === 'PAYMENT_FAILED') setSubmitError('Payment could not be authorised. Try another method.');
    else setSubmitError(me.message);
  };

  const onRequest = () => {
    if (!est) return;
    setSubmitError(null);
    // Cash rides settle in-vehicle — no upfront debit, so skip the payment sheet.
    if (paymentMethod === 'cash') {
      request.mutate(
        { pickup, dest, serviceType, pricingMode, offerKobo: pricingMode === 'offer' ? offerKobo : undefined, paymentMethod },
        { onSuccess: onRideCreated, onError: onRideError },
      );
      return;
    }
    // Wallet / card → shared PaymentSheet (PIN + KYC/tier gating live inside it),
    // mirroring the carhire & bus flows. The ride request runs as the charge.
    pay.start({
      amountKobo: pricingMode === 'offer' ? (offerKobo || est.systemFareKobo) : est.systemFareKobo,
      title: pricingMode === 'offer' ? 'Confirm your fare offer' : 'Pay for your ride',
      domain: 'ride',
      method: paymentMethod === 'wallet' ? 'wallet' : 'card',
      charge: async (m) => {
        try {
          return await submitRide(m === 'card' ? 'card' : 'wallet');
        } catch (e) {
          // Translate fare-bound errors into a friendly message inside the sheet.
          const me = toMobilityError(e);
          if (isFareBoundError(me)) throw new Error(fareBoundMessage(me, est.offerMinKobo, est.offerMaxKobo));
          throw me;
        }
      },
      onPaid: onRideCreated,
    });
  };

  const fareError = estimate.isError;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Confirm your ride" />

      {fareError ? (
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => estimate.mutate({ pickup, dest, serviceType })} />
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            <MobilityMap
              height={170}
              showRoute
              pickup={pickup}
              dropoff={dest}
              caption={est ? `${(est.distanceM / 1000).toFixed(1)} km` : 'Calculating route…'}
            />

            {/* Both stops are editable inline — tap pickup or destination to
                open its address picker. */}
            <View style={styles.routeWrap}>
              <TripRouteCard
                pickup={pickup}
                dest={dest}
                onEditPickup={() => setEditingPickup(true)}
                onEditDest={() => setEditingDest(true)}
              />
            </View>

            {/* While pickup is still resolving (or unset) show the full input
                row with its loading / empty states; once known, the route card
                above is the single, editable source. */}
            {(!pickupResolved || location.loading) && (
            <Pressable style={styles.pickupRow} onPress={() => setEditingPickup(true)} accessibilityLabel="Edit pickup location">
              <View style={styles.pickupIcon}>
                {location.loading && !pickupResolved ? (
                  <ActivityIndicator color={Colors.primary} size="small" />
                ) : pickupResolved && !pickupIsManual ? (
                  // GPS-detected current location keeps the crosshair.
                  <LocateFixed size={18} color={Colors.primary} strokeWidth={2.2} />
                ) : (
                  // A manually-entered / stated pickup uses a neutral map pin.
                  <MapPin size={18} color={pickupResolved ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2.2} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.pickupLabel}>{pickupIsManual ? 'Pickup location' : 'Pickup'}</Text>
                <Text style={[styles.pickupAddr, !pickupResolved && !location.loading && styles.pickupPlaceholder]} numberOfLines={1}>
                  {location.loading && !pickupResolved
                    ? 'Finding your location…'
                    : pickupResolved
                      ? pickup.address
                      : 'Enter pickup address'}
                </Text>
                {!pickupResolved && !location.loading && (
                  <Text style={styles.pickupHint}>
                    {location.error ?? 'Tap to search or drop a pin for your exact pickup point.'}
                  </Text>
                )}
              </View>
              <Pencil size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
            )}

            {/* Service categories */}
            <Text style={styles.sectionLabel}>Choose a ride</Text>
            <View style={styles.serviceList}>
              {SERVICE_TYPES.map((meta) => (
                <ServiceTypeCard
                  key={meta.value}
                  meta={meta}
                  // Per-category fare only shown for the selected (estimated) type;
                  // others show — until selected (server is the source of truth).
                  fareKobo={meta.value === serviceType ? est?.systemFareKobo : undefined}
                  etaMin={meta.value === serviceType && est ? Math.max(2, Math.round(est.durationS / 60 / 6)) : undefined}
                  selected={serviceType === meta.value}
                  onPress={() => setServiceType(meta.value)}
                />
              ))}
            </View>

            {/* Instant vs Offer */}
            {RIDE_NEGOTIATION_ENABLED && (
              <>
                <Text style={styles.sectionLabel}>Fare</Text>
                <View style={styles.modeRow}>
                  <ModeOption
                    active={pricingMode === 'instant'}
                    icon={<Zap size={18} color={pricingMode === 'instant' ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2.2} />}
                    title="Instant fare"
                    subtitle={est ? formatNairaWhole(est.systemFareKobo) : '—'}
                    onPress={() => setPricingMode('instant')}
                  />
                  <ModeOption
                    active={pricingMode === 'offer'}
                    icon={<HandCoins size={18} color={pricingMode === 'offer' ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2.2} />}
                    title="Name your fare"
                    subtitle="Make an offer"
                    onPress={() => setPricingMode('offer')}
                  />
                </View>

                {pricingMode === 'offer' && est && (
                  <View style={styles.offerWrap}>
                    <FareOfferSheet
                      systemFareKobo={est.systemFareKobo}
                      offerMinKobo={est.offerMinKobo}
                      offerMaxKobo={est.offerMaxKobo}
                      value={offerKobo || est.systemFareKobo}
                      onChange={setOfferKobo}
                      error={submitError}
                    />
                  </View>
                )}
              </>
            )}

            {/* Payment method (reuses existing wallet/payment) */}
            <Text style={styles.sectionLabel}>Payment</Text>
            <View style={styles.payRow}>
              {PAYMENT_METHODS.map((m) => {
                const active = paymentMethod === m.value;
                const Icon = m.icon;
                return (
                  <Pressable key={m.value} style={[styles.payOption, active && styles.payOptionActive]} onPress={() => setPaymentMethod(m.value)}>
                    <Icon size={18} color={active ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2} />
                    <Text style={[styles.payLabel, active && styles.payLabelActive]}>{m.label}</Text>
                    {active && <Check size={16} color={Colors.primary} strokeWidth={2.5} />}
                  </Pressable>
                );
              })}
            </View>

            {submitError && pricingMode === 'instant' && (
              <Text style={styles.submitError}>{submitError}</Text>
            )}
          </ScrollView>

          {/* CTA */}
          <View style={styles.footer}>
            <View style={styles.fareRow}>
              <Text style={styles.fareLabel}>{pricingMode === 'offer' ? 'Your offer' : 'Total fare'}</Text>
              {estimate.isPending && !est ? (
                <ActivityIndicator color={Colors.primary} />
              ) : (
                <Text style={styles.fareValue}>
                  {formatNairaWhole(pricingMode === 'offer' ? (offerKobo || est?.systemFareKobo || 0) : est?.systemFareKobo ?? 0)}
                </Text>
              )}
            </View>
            <PrimaryButton
              label={pickupResolved ? (pricingMode === 'offer' ? 'Send offer to drivers' : 'Request ride') : 'Set pickup to continue'}
              onPress={pickupResolved ? onRequest : () => setEditingPickup(true)}
              loading={request.isPending || pay.phase === 'charging' || pay.phase === 'awaiting'}
              disabled={(!est || estimate.isPending) && pickupResolved}
            />
          </View>
        </>
      )}

      {/* Shared wallet/card chooser — drives the ride-request charge above. */}
      <PaymentSheet controller={pay} />

      {/* Edit pickup: autocomplete + confirm-on-map pin (Nigeria address rule). */}
      <Modal visible={editingPickup} animationType="slide" onRequestClose={() => setEditingPickup(false)}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Set pickup</Text>
            <Pressable onPress={() => setEditingPickup(false)} hitSlop={10} accessibilityLabel="Close">
              <X size={22} color={Colors.onSurface} strokeWidth={2} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <AddressEntry
              surface="checkout"
              initialCenter={{ lat: pickup.lat, lng: pickup.lng }}
              initialQuery={pickupResolved ? pickup.address : ''}
              onConfirmed={onPickupConfirmed}
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Edit destination: same autocomplete + confirm-on-map pin. */}
      <Modal visible={editingDest} animationType="slide" onRequestClose={() => setEditingDest(false)}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Set destination</Text>
            <Pressable onPress={() => setEditingDest(false)} hitSlop={10} accessibilityLabel="Close">
              <X size={22} color={Colors.onSurface} strokeWidth={2} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <AddressEntry
              surface="checkout"
              initialCenter={{ lat: dest.lat, lng: dest.lng }}
              initialQuery={dest.address}
              onConfirmed={onDestConfirmed}
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function ModeOption({ active, icon, title, subtitle, onPress }: { active: boolean; icon: React.ReactNode; title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable style={[styles.mode, active && styles.modeActive]} onPress={onPress}>
      <View style={styles.modeIcon}>{icon}</View>
      <Text style={[styles.modeTitle, active && styles.modeTitleActive]}>{title}</Text>
      <Text style={styles.modeSub}>{subtitle}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg, gap: Spacing.md },
  routeWrap: { marginTop: Spacing.xs },
  pickupRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  pickupIcon: { width: 38, height: 38, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  pickupLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  pickupAddr: { ...Typography.labelMd, color: Colors.onSurface },
  pickupPlaceholder: { color: Colors.onSurfaceVariant },
  pickupHint: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md },
  modalTitle: { ...Typography.titleMd, color: Colors.onSurface },
  modalScroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg },
  sectionLabel: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.sm },
  serviceList: { gap: Spacing.sm },
  modeRow: { flexDirection: 'row', gap: Spacing.sm },
  mode: { flex: 1, gap: 4, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  modeActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  modeIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  modeTitle: { ...Typography.labelMd, color: Colors.onSurface, marginTop: 4 },
  modeTitleActive: { color: Colors.primary },
  modeSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  offerWrap: { marginTop: Spacing.sm },
  payRow: { gap: Spacing.sm },
  payOption: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  payOptionActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  payLabel: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  payLabelActive: { color: Colors.primary, fontWeight: '600' as const },
  submitError: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.sm },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fareLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  fareValue: { ...Typography.headlineMd, color: Colors.primary, fontWeight: '800' as const },
});
