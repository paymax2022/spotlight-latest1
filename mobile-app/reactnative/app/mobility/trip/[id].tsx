import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Phone, X, Clock3 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import MapPlaceholder from '@/features/mobility/components/MapPlaceholder';
import DriverCard from '@/features/mobility/components/DriverCard';
import VehicleCard from '@/features/mobility/components/VehicleCard';
import TripPinDisplay from '@/features/mobility/components/TripPinDisplay';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import SafetyButton from '@/features/mobility/components/SafetyButton';
import FareBreakdownCard from '@/features/mobility/components/FareBreakdownCard';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useTrip, useFareNegotiation, useCancelRide, useSafety } from '@/features/mobility/hooks/useMobility';
import { formatNairaWhole, formatEta } from '@/features/mobility/utils/mobilityFormatters';
import { PHASE_LABEL } from '@/features/mobility/constants/mobility.constants';
import type { LatLng } from '@/features/mobility/types/mobility.types';

const SHARE_LOC: LatLng = { lat: 6.44, lng: 3.46 };

export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = useTrip(id, { poll: true });
  const { acceptCounter } = useFareNegotiation(id);
  const cancel = useCancelRide();
  const safety = useSafety(id);
  const [cancelling, setCancelling] = useState(false);

  const t = trip.data;

  // Terminal redirects
  React.useEffect(() => {
    if (!t) return;
    if (t.phase === 'completed') router.replace(`/mobility/trip/${id}/rate`);
    if (t.phase === 'cancelled') router.replace('/mobility');
  }, [t?.phase, id]);

  const onShare = () => {
    if (!id) return;
    safety.shareTrip.mutate(id, {
      onSuccess: (link) => Alert.alert('Trip shared', `Live link: ${link.url}`),
    });
  };

  const onSos = async () => {
    if (!id) return;
    await safety.sos.mutateAsync({ id, loc: SHARE_LOC });
    Alert.alert('SOS sent', 'Paymax safety has been alerted and your live location shared.');
  };

  const onCancel = () => {
    if (!id) return;
    setCancelling(true);
    cancel.mutate({ tripId: id, reason: 'Cancelled by rider' }, {
      onSettled: () => setCancelling(false),
      onSuccess: () => router.replace('/mobility'),
    });
  };

  if (trip.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Your trip" />
        <StateView kind="loading" message="Loading your trip…" />
      </SafeAreaView>
    );
  }

  if (trip.isError || !t) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Your trip" />
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => trip.refetch()} />
      </SafeAreaView>
    );
  }

  if (t.safetyHold) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Safety hold" />
        <MobilityEdgeState
          kind="restricted"
          title="Trip on safety hold"
          message="Our safety team is reviewing this trip after your SOS. We will contact you shortly. Stay safe."
        />
      </SafeAreaView>
    );
  }

  const negotiating = t.phase === 'fare_negotiating';
  const arriving = t.phase === 'driver_assigned' || t.phase === 'driver_arriving';
  const inProgress = t.phase === 'in_progress' || t.phase === 'pin_verified';
  const counter = t.fareOffer?.driverCounterKobo;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={PHASE_LABEL[t.phase] ?? 'Your trip'} showBack={!inProgress} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <MapPlaceholder height={200} showRoute caption={inProgress ? 'On the way to your destination' : arriving ? 'Driver heading to your pickup' : undefined} />

        <View style={styles.statusRow}>
          <StatusBadge phase={t.phase} />
          {arriving && t.driverEtaS != null && (
            <View style={styles.etaPill}>
              <Clock3 size={14} color={Colors.primary} strokeWidth={2.2} />
              <Text style={styles.etaText}>Arrives in {formatEta(t.driverEtaS)}</Text>
            </View>
          )}
        </View>

        {/* ── Fare negotiation ── */}
        {negotiating && (
          <View style={[styles.card, shadow1]}>
            <Text style={styles.cardTitle}>Fare negotiation</Text>
            <View style={styles.offerRow}>
              <Text style={styles.offerLabel}>Your offer</Text>
              <Text style={styles.offerValue}>{formatNairaWhole(t.fareOffer?.riderOfferKobo ?? t.fareKobo)}</Text>
            </View>
            {counter != null ? (
              <>
                <View style={styles.offerRow}>
                  <Text style={styles.offerLabel}>Driver counter</Text>
                  <Text style={[styles.offerValue, styles.counterValue]}>{formatNairaWhole(counter)}</Text>
                </View>
                <PrimaryButton
                  label={`Accept ${formatNairaWhole(counter)}`}
                  onPress={() => acceptCounter.mutate(id!)}
                  loading={acceptCounter.isPending}
                  style={{ marginTop: Spacing.md }}
                />
                <Pressable onPress={onCancel} style={styles.declineBtn} disabled={cancelling}>
                  <Text style={styles.declineLabel}>Decline & cancel</Text>
                </Pressable>
              </>
            ) : (
              <View style={styles.waitingRow}>
                <Text style={styles.waitingText}>Waiting for a driver to respond to your offer…</Text>
              </View>
            )}
          </View>
        )}

        {/* ── Driver + vehicle ── */}
        {t.driver && t.vehicle && (
          <View style={[styles.card, shadow1]}>
            <DriverCard
              driver={t.driver}
              subtitle={t.driver.phoneMasked ?? undefined}
              onCall={() => Alert.alert('Calling driver', 'Connecting via anonymous number…')}
              onMessage={() => Alert.alert('Message', 'In-app chat opening…')}
            />
            <View style={{ height: Spacing.md }} />
            <VehicleCard vehicle={t.vehicle} />
          </View>
        )}

        {/* ── Trip PIN (arriving) ── */}
        {arriving && t.tripPin && (
          <TripPinDisplay pin={t.tripPin} />
        )}

        {/* ── Fare summary ── */}
        <FareBreakdownCard
          fareKobo={t.fareKobo}
          distanceM={t.distanceM}
          durationS={t.durationS}
          surgeMultiplier={t.surgeMultiplier}
          rows={[
            { label: 'Base fare', valueText: t.pricingMode === 'offer' ? 'Agreed offer' : 'Standard fare' },
            { label: 'Payment', valueText: t.paymentMethod === 'wallet' ? 'Paymax wallet' : t.paymentMethod === 'card' ? 'Card' : 'Cash' },
          ]}
          showTrustNote
        />
      </ScrollView>

      {/* ── Bottom safety / actions ── */}
      <View style={styles.footer}>
        {(arriving || inProgress) && (
          <SafetyButton onSos={onSos} onShare={onShare} sosPending={safety.sos.isPending} />
        )}
        {arriving && (
          <Pressable onPress={onCancel} disabled={cancelling} style={styles.cancelLink} accessibilityLabel="Cancel trip">
            <X size={16} color={Colors.error} strokeWidth={2.2} />
            <Text style={styles.cancelLinkLabel}>{cancelling ? 'Cancelling…' : 'Cancel trip'}</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg, gap: Spacing.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  etaPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primaryFixed, borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 6 },
  etaText: { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' as const },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.outlineVariant },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface, marginBottom: Spacing.sm },
  offerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  offerLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  offerValue: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' as const },
  counterValue: { color: Colors.primary },
  waitingRow: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.sm },
  waitingText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  declineBtn: { height: 48, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.xs },
  declineLabel: { ...Typography.labelMd, color: Colors.error },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.sm },
  cancelLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: Spacing.sm },
  cancelLinkLabel: { ...Typography.labelMd, color: Colors.error },
});
