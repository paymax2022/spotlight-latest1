import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Zap, HandCoins, Wallet, CreditCard, Banknote, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import MapPlaceholder from '@/features/mobility/components/MapPlaceholder';
import TripRouteCard from '@/features/mobility/components/TripRouteCard';
import ServiceTypeCard from '@/features/mobility/components/ServiceTypeCard';
import FareOfferSheet from '@/features/mobility/components/FareOfferSheet';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useRideEstimate, useRideRequest } from '@/features/mobility/hooks/useMobility';
import { SERVICE_TYPES, RIDE_NEGOTIATION_ENABLED } from '@/features/mobility/constants/mobility.constants';
import { toMobilityError, isNoDriverError, isFareBoundError, fareBoundMessage, formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import type { ServiceType, PricingMode, PaymentMethod, Place, RideEstimate } from '@/features/mobility/types/mobility.types';

const DEFAULT_PICKUP: Place = { address: '14 Admiralty Way, Lekki Phase 1', lat: 6.4459, lng: 3.4730, label: 'Current location' };

const PAYMENT_METHODS: { value: PaymentMethod; label: string; icon: typeof Wallet }[] = [
  { value: 'wallet', label: 'Paymax wallet', icon: Wallet },
  { value: 'card', label: 'Card', icon: CreditCard },
  { value: 'cash', label: 'Cash', icon: Banknote },
];

export default function EstimateScreen() {
  const params = useLocalSearchParams<{ destAddress?: string; lat?: string; lng?: string }>();

  const dest: Place = useMemo(
    () => ({
      address: params.destAddress ?? 'Plot 5, Idejo St, Victoria Island',
      lat: params.lat ? Number(params.lat) : 6.4281,
      lng: params.lng ? Number(params.lng) : 3.4219,
    }),
    [params.destAddress, params.lat, params.lng],
  );

  const [serviceType, setServiceType] = useState<ServiceType>('economy');
  const [pricingMode, setPricingMode] = useState<PricingMode>('instant');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('wallet');
  const [offerKobo, setOfferKobo] = useState<number>(0);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const estimate = useRideEstimate();
  const request = useRideRequest();
  const est: RideEstimate | undefined = estimate.data;

  // Fetch estimate whenever the service type changes.
  useEffect(() => {
    setSubmitError(null);
    estimate.mutate(
      { pickup: DEFAULT_PICKUP, dest, serviceType },
      { onSuccess: (e) => setOfferKobo(e.systemFareKobo) },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceType, dest]);

  const onRequest = () => {
    if (!est) return;
    setSubmitError(null);
    request.mutate(
      {
        pickup: DEFAULT_PICKUP,
        dest,
        serviceType,
        pricingMode,
        offerKobo: pricingMode === 'offer' ? offerKobo : undefined,
        paymentMethod,
      },
      {
        onSuccess: (trip) => {
          if (trip.phase === 'fare_negotiating') router.replace(`/mobility/trip/${trip.id}`);
          else router.replace(`/mobility/searching?tripId=${trip.id}`);
        },
        onError: (e) => {
          const me = toMobilityError(e);
          if (isFareBoundError(me)) setSubmitError(fareBoundMessage(me, est.offerMinKobo, est.offerMaxKobo));
          else if (isNoDriverError(me)) setSubmitError(null); // handled on next screen
          else if (me.code === 'PAYMENT_FAILED') setSubmitError('Payment could not be authorised. Try another method.');
          else setSubmitError(me.message);
        },
      },
    );
  };

  const fareError = estimate.isError;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Confirm your ride" />

      {fareError ? (
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => estimate.mutate({ pickup: DEFAULT_PICKUP, dest, serviceType })} />
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            <MapPlaceholder height={170} showRoute caption={est ? `${(est.distanceM / 1000).toFixed(1)} km` : 'Calculating route…'} />

            <View style={styles.routeWrap}>
              <TripRouteCard pickup={DEFAULT_PICKUP} dest={dest} />
            </View>

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
              label={pricingMode === 'offer' ? 'Send offer to drivers' : 'Request ride'}
              onPress={onRequest}
              loading={request.isPending}
              disabled={!est || estimate.isPending}
            />
          </View>
        </>
      )}
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
