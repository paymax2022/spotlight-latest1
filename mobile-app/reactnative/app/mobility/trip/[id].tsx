import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Phone, X, Clock3, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import MobilityMap from '@/features/mobility/components/MobilityMap';
import DriverCard from '@/features/mobility/components/DriverCard';
import VehicleCard from '@/features/mobility/components/VehicleCard';
import TripPinDisplay from '@/features/mobility/components/TripPinDisplay';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import SafetyButton from '@/features/mobility/components/SafetyButton';
import FareBreakdownCard from '@/features/mobility/components/FareBreakdownCard';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useTrip, useFareNegotiation, useCancelRide, useSafety } from '@/features/mobility/hooks/useMobility';
import { useTripRealtime } from '@/features/mobility/hooks/useTripRealtime';
import { formatNairaWhole, formatEta } from '@/features/mobility/utils/mobilityFormatters';
import { PHASE_LABEL } from '@/features/mobility/constants/mobility.constants';
import type { LatLng } from '@/features/mobility/types/mobility.types';

const SHARE_LOC: LatLng = { lat: 6.44, lng: 3.46 };

// Rider-side cancellation reasons. The chosen reason rides on the existing
// cancel API (`reason` string) — ops uses it for driver quality + refund calls.
const CANCEL_REASONS = [
  'Driver is taking too long',
  'Driver asked me to cancel',
  'Change of plans',
  'Booked by mistake',
  'Fare is too high',
  'Other',
] as const;

export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = useTrip(id, { poll: true });
  const { acceptCounter } = useFareNegotiation(id);
  const cancel = useCancelRide();
  const safety = useSafety(id);
  const [cancelling, setCancelling] = useState(false);

  const t = trip.data;
  // Live driver position + status over the trip WebSocket; polling above remains
  // the fallback when realtime is unavailable (or in mock mode).
  const realtime = useTripRealtime(id, { phase: t?.phase });

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

  // Cancel flow: always ask WHY before cancelling (reason sheet), then submit.
  const [cancelSheetOpen, setCancelSheetOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState<string>('');
  const [cancelNote, setCancelNote] = useState('');

  const onCancel = () => {
    if (!id) return;
    setCancelReason('');
    setCancelNote('');
    setCancelSheetOpen(true);
  };

  const confirmCancel = () => {
    if (!id || !cancelReason) return;
    const reason =
      cancelReason === 'Other'
        ? `Other${cancelNote.trim() ? `: ${cancelNote.trim()}` : ''}`
        : cancelReason;
    setCancelling(true);
    cancel.mutate({ tripId: id, reason }, {
      onSettled: () => setCancelling(false),
      onSuccess: () => {
        setCancelSheetOpen(false);
        router.replace('/mobility');
      },
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
  // Rider can cancel any time before the ride starts (PIN verified / on-trip).
  const cancellable = t.phase === 'requested' || negotiating || arriving;
  const counter = t.fareOffer?.driverCounterKobo;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={PHASE_LABEL[t.phase] ?? 'Your trip'} showBack={!inProgress} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <MobilityMap
          height={200}
          showRoute
          pickup={t.pickup}
          dropoff={t.dest}
          driver={realtime.driver}
          route={realtime.route}
          caption={inProgress ? 'On the way to your destination' : arriving ? 'Driver heading to your pickup' : undefined}
        />

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
        {cancellable && (
          <Pressable onPress={onCancel} disabled={cancelling} style={styles.cancelLink} accessibilityLabel="Cancel trip">
            <X size={16} color={Colors.error} strokeWidth={2.2} />
            <Text style={styles.cancelLinkLabel}>{cancelling ? 'Cancelling…' : 'Cancel trip'}</Text>
          </Pressable>
        )}
      </View>

      {/* ── Cancel reason sheet — the rider always tells us WHY ── */}
      <Modal visible={cancelSheetOpen} animationType="slide" transparent onRequestClose={() => setCancelSheetOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Why are you cancelling?</Text>
              <Pressable onPress={() => setCancelSheetOpen(false)} hitSlop={10} accessibilityLabel="Close">
                <X size={20} color={Colors.onSurface} strokeWidth={2} />
              </Pressable>
            </View>
            <Text style={styles.sheetSub}>This helps us improve pickups and handle refunds correctly.</Text>

            {CANCEL_REASONS.map((r) => {
              const active = cancelReason === r;
              return (
                <Pressable key={r} onPress={() => setCancelReason(r)} style={[styles.reasonRow, active && styles.reasonRowActive]} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                  <View style={[styles.radio, active && styles.radioActive]}>
                    {active && <Check size={12} color="#fff" strokeWidth={3} />}
                  </View>
                  <Text style={[styles.reasonLabel, active && styles.reasonLabelActive]}>{r}</Text>
                </Pressable>
              );
            })}

            {cancelReason === 'Other' && (
              <TextInput
                style={styles.noteInput}
                value={cancelNote}
                onChangeText={setCancelNote}
                placeholder="Tell us a little more (optional)"
                placeholderTextColor={Colors.outline}
                multiline
                maxLength={200}
              />
            )}

            <PrimaryButton
              label={cancelling ? 'Cancelling…' : 'Cancel this trip'}
              onPress={confirmCancel}
              loading={cancelling}
              disabled={!cancelReason}
              style={{ marginTop: Spacing.md }}
            />
            <Pressable onPress={() => setCancelSheetOpen(false)} style={styles.keepBtn} disabled={cancelling}>
              <Text style={styles.keepLabel}>Keep my trip</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.xs },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { ...Typography.titleMd, color: Colors.onSurface },
  sheetSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.outlineVariant, marginBottom: 6 },
  reasonRowActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  radioActive: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  reasonLabel: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  reasonLabelActive: { color: Colors.primary, fontWeight: '600' as const },
  noteInput: { ...Typography.bodyMd, color: Colors.onSurface, borderWidth: 1, borderColor: Colors.outlineVariant, borderRadius: Radius.md, padding: Spacing.md, minHeight: 64, marginTop: 4 },
  keepBtn: { alignItems: 'center', paddingVertical: Spacing.sm, marginTop: 2 },
  keepLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
});
