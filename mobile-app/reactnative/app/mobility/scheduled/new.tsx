import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, AlertTriangle, MapPin, LocateFixed } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import SelectableCard from '@/features/mobility/components/SelectableCard';
import FareBreakdownCard from '@/features/mobility/components/FareBreakdownCard';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useScheduledEstimate, useCreateScheduled } from '@/features/mobility/hooks/useScheduled';
import { useBusSchedules } from '@/features/mobility/hooks/useModes';
import { SCHEDULED_MODE_META, SCHEDULED_ENABLED, VEHICLE_CLASSES } from '@/features/mobility/constants/modes.constants';
import { formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import type {
  ScheduledMode,
  ScheduledPlace,
  ScheduledModePayload,
  RideModePayload,
  ParcelModePayload,
  AirportModePayload,
  BusModePayload,
  VehicleClass,
} from '@/features/mobility/api/scheduled.api';

// Draft scope is stable for the lifetime of this screen instance so its
// persisted Idempotency-Key survives an app kill mid-submit and a retry
// reuses the same key instead of risking a duplicate booking.
function useDraftScope() {
  return useMemo(() => `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, []);
}

const DEFAULT_PICKUP: ScheduledPlace = { label: '14 Admiralty Way, Lekki Phase 1', lat: 6.4459, lng: 3.473 };
const DEFAULT_DROPOFF: ScheduledPlace = { label: 'Ikeja City Mall, Alausa', lat: 6.6186, lng: 3.3585 };

function defaultPickupAt(): string {
  const d = new Date(Date.now() + 2 * 3_600_000);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

export default function ScheduleNewTripScreen() {
  const params = useLocalSearchParams<{
    pickupAddress?: string; pickupLat?: string; pickupLng?: string;
    destAddress?: string; lat?: string; lng?: string;
    target?: string;
  }>();
  const draftScope = useDraftScope();

  const [mode, setMode] = useState<ScheduledMode>('ride_hail');
  const [scheduledPickupAt, setScheduledPickupAt] = useState(defaultPickupAt());
  const [vehicleClass, setVehicleClass] = useState<VehicleClass>('economy');

  // Parcel fields (intra vs inter-state is chosen via the mode picker above,
  // not a separate toggle — parcel_intra / parcel_inter are distinct modes).
  const [dimensions, setDimensions] = useState('30x20x15 cm');
  const [weightKg, setWeightKg] = useState('2');

  // Airport fields
  const [flightNumber, setFlightNumber] = useState('');
  const [arrivalTime, setArrivalTime] = useState('');
  const [terminal, setTerminal] = useState('');

  // Bus fields
  const [busRouteId, setBusRouteId] = useState('');
  const [busScheduleId, setBusScheduleId] = useState('');
  const [busSeat, setBusSeat] = useState('1');

  const [submitError, setSubmitError] = useState<string | null>(null);

  // Pickup/dropoff — reuse the shared AddressEntry flow (via destination.tsx)
  // exactly like the mobility home planner: values round-trip through URL params.
  const pickup: ScheduledPlace = useMemo(
    () => (params.pickupAddress
      ? { label: String(params.pickupAddress), lat: Number(params.pickupLat) || DEFAULT_PICKUP.lat, lng: Number(params.pickupLng) || DEFAULT_PICKUP.lng }
      : DEFAULT_PICKUP),
    [params.pickupAddress, params.pickupLat, params.pickupLng],
  );
  const dropoff: ScheduledPlace = useMemo(
    () => (params.destAddress
      ? { label: String(params.destAddress), lat: Number(params.lat) || DEFAULT_DROPOFF.lat, lng: Number(params.lng) || DEFAULT_DROPOFF.lng }
      : DEFAULT_DROPOFF),
    [params.destAddress, params.lat, params.lng],
  );

  const enc = encodeURIComponent;
  const pickerHref = (target: 'pickup' | 'destination') => {
    let q = `?target=${target}&returnTo=${enc('/mobility/scheduled/new')}`;
    if (target === 'pickup' && params.destAddress) q += `&destAddress=${enc(String(params.destAddress))}&lat=${enc(String(params.lat ?? ''))}&lng=${enc(String(params.lng ?? ''))}`;
    if (target === 'destination' && params.pickupAddress) q += `&pickupAddress=${enc(String(params.pickupAddress))}&pickupLat=${enc(String(params.pickupLat ?? ''))}&pickupLng=${enc(String(params.pickupLng ?? ''))}`;
    return `/mobility/destination${q}`;
  };

  const busSchedules = useBusSchedules(busRouteId || undefined, new Date(scheduledPickupAt).toISOString().slice(0, 10));

  const modePayload: ScheduledModePayload = useMemo(() => {
    if (mode === 'ride_hail' || mode === 'ride_share') {
      return { pricingMode: 'fixed', vehicleClass } as RideModePayload;
    }
    if (mode === 'parcel_intra' || mode === 'parcel_inter') {
      return { dimensions, weightKg: Number(weightKg) || 0, interState: mode === 'parcel_inter' } as ParcelModePayload;
    }
    if (mode === 'airport_pickup') {
      return {
        flightNumber: flightNumber || undefined,
        arrivalTime: arrivalTime || undefined,
        terminal: terminal || undefined,
      } as AirportModePayload;
    }
    return { scheduleId: busScheduleId, seatNumber: busSeat } as BusModePayload;
  }, [mode, vehicleClass, dimensions, weightKg, flightNumber, arrivalTime, terminal, busScheduleId, busSeat]);

  // Airport: when an arrival time is set, the pickup time is derived (+45m),
  // matching the backend rule, but stays adjustable here.
  useEffect(() => {
    if (mode === 'airport_pickup' && arrivalTime) {
      const derived = new Date(new Date(arrivalTime).getTime() + 45 * 60_000);
      if (!Number.isNaN(derived.getTime())) setScheduledPickupAt(derived.toISOString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivalTime]);

  const estimate = useScheduledEstimate();
  const create = useCreateScheduled(draftScope);

  useEffect(() => {
    setSubmitError(null);
    estimate.mutate({ mode, scheduledPickupAt, pickup, dropoff, modePayload });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, scheduledPickupAt, pickup, dropoff, modePayload]);

  if (!SCHEDULED_ENABLED) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Schedule a trip" />
        <MobilityEdgeState kind="serviceUnavailable" />
      </SafeAreaView>
    );
  }

  const modeNeedsParcel = mode === 'parcel_intra' || mode === 'parcel_inter';
  const modeNeedsAirport = mode === 'airport_pickup';
  const modeNeedsBus = mode === 'bus';
  const modeNeedsRide = mode === 'ride_hail' || mode === 'ride_share';

  const canSubmit =
    !!estimate.data &&
    scheduledPickupAt.length > 0 &&
    (!modeNeedsBus || (busScheduleId.trim().length > 0 && busSeat.trim().length > 0)) &&
    (!modeNeedsParcel || (Number(weightKg) > 0 && dimensions.trim().length > 0)) &&
    !create.isPending;

  const onSubmit = async () => {
    setSubmitError(null);
    try {
      const result = await create.mutateAsync({
        mode,
        scheduledPickupAt,
        pickup,
        dropoff,
        modePayload,
        paymentMethod: 'wallet',
      });
      router.replace(`/mobility/scheduled/${result.booking.id}`);
    } catch (e) {
      setSubmitError((e as Error).message ?? 'Could not schedule this trip. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Schedule a trip" subtitle="Book your logistics movement ahead of time" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.section}>What do you need?</Text>
        <View style={styles.grid2}>
          {SCHEDULED_MODE_META.map((m) => (
            <View key={m.value} style={styles.gridHalf}>
              <SelectableCard title={m.label} subtitle={m.hint} icon={m.icon} selected={mode === m.value} onPress={() => setMode(m.value)} />
            </View>
          ))}
        </View>

        <Text style={styles.section}>Pickup & drop-off</Text>
        <Pressable style={styles.placeRow} onPress={() => router.push(pickerHref('pickup'))} accessibilityLabel="Set pickup point">
          <MapPin size={18} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.placeText} numberOfLines={1}>{pickup.label}</Text>
        </Pressable>
        {!modeNeedsBus && (
          <Pressable style={styles.placeRow} onPress={() => router.push(pickerHref('destination'))} accessibilityLabel="Set destination">
            <LocateFixed size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.placeText} numberOfLines={1}>{dropoff.label}</Text>
          </Pressable>
        )}

        <Text style={styles.section}>When</Text>
        <TextInputField
          label="Pickup date & time (ISO)"
          value={scheduledPickupAt}
          onChangeText={setScheduledPickupAt}
          placeholder="YYYY-MM-DDTHH:mm:00Z"
          editable={!(mode === 'airport_pickup' && !!arrivalTime)}
        />

        {modeNeedsRide && (
          <>
            <Text style={styles.section}>Vehicle class</Text>
            <View style={styles.list}>
              {VEHICLE_CLASSES.map((v) => (
                <SelectableCard key={v.value} title={v.label} subtitle={v.hint} selected={vehicleClass === v.value} onPress={() => setVehicleClass(v.value)} />
              ))}
            </View>
          </>
        )}

        {modeNeedsParcel && (
          <>
            <Text style={styles.section}>Parcel details</Text>
            <TextInputField label="Dimensions" value={dimensions} onChangeText={setDimensions} placeholder="e.g. 30x20x15 cm" />
            <TextInputField label="Weight (kg)" value={weightKg} onChangeText={(t) => setWeightKg(t.replace(/[^0-9.]/g, ''))} placeholder="0" keyboardType="decimal-pad" />
            <View style={[styles.toggleRow, styles.toggleRowOn]}>
              <Text style={styles.toggleLabel}>
                {mode === 'parcel_inter' ? 'Inter-state delivery' : 'Intra-state (same city) delivery'}
              </Text>
            </View>
          </>
        )}

        {modeNeedsAirport && (
          <>
            <Text style={styles.section}>Flight details</Text>
            <TextInputField label="Flight number (optional)" value={flightNumber} onChangeText={setFlightNumber} placeholder="e.g. BA075" autoCapitalize="characters" />
            <TextInputField label="Arrival time (optional, ISO)" value={arrivalTime} onChangeText={setArrivalTime} placeholder="YYYY-MM-DDTHH:mm:00Z" />
            <TextInputField label="Terminal (optional)" value={terminal} onChangeText={setTerminal} placeholder="e.g. International" />
            {arrivalTime ? <Text style={styles.hint}>Pickup time is derived from your arrival time (+45 min) — you can still adjust it above.</Text> : null}
          </>
        )}

        {modeNeedsBus && (
          <>
            <Text style={styles.section}>Bus departure</Text>
            <TextInputField label="Route ID" value={busRouteId} onChangeText={setBusRouteId} placeholder="Route id from search" />
            {busRouteId ? (
              busSchedules.isLoading ? (
                <ActivityIndicator color={Colors.primary} />
              ) : busSchedules.isError ? (
                <MobilityEdgeState kind="offline" compact actionLabel="Retry" onAction={() => busSchedules.refetch()} />
              ) : (busSchedules.data?.length ?? 0) === 0 ? (
                <Text style={styles.hint}>No departures found for that route/date.</Text>
              ) : (
                <View style={styles.list}>
                  {busSchedules.data!.map((s) => (
                    <SelectableCard
                      key={s.id}
                      title={`${new Date(s.departAt).toLocaleString('en-NG', { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}`}
                      subtitle={`${s.busType} · ${s.seatsLeft} seats left`}
                      selected={busScheduleId === s.id}
                      onPress={() => setBusScheduleId(s.id)}
                    />
                  ))}
                </View>
              )
            ) : null}
            <TextInputField label="Seat number" value={busSeat} onChangeText={setBusSeat} placeholder="e.g. 12" keyboardType="number-pad" />
          </>
        )}

        {estimate.isPending ? (
          <View style={styles.estimateLoading}><ActivityIndicator color={Colors.primary} /><Text style={styles.hint}>Getting a fare estimate…</Text></View>
        ) : estimate.data ? (
          <FareBreakdownCard
            title="Estimated fare"
            fareKobo={estimate.data.estimatedFareKobo}
            distanceM={estimate.data.distanceM}
            durationS={estimate.data.durationS}
            rows={[{ label: 'Estimated total', valueKobo: estimate.data.estimatedFareKobo }]}
            showTrustNote
          />
        ) : estimate.isError ? (
          <MobilityEdgeState kind="offline" compact actionLabel="Retry" onAction={() => estimate.mutate({ mode, scheduledPickupAt, pickup, dropoff, modePayload })} />
        ) : null}

        <View style={styles.noteCard}>
          <Check size={16} color={Colors.tertiaryContainer} strokeWidth={2.4} />
          <Text style={styles.noteText}>You are not charged now — your wallet is only charged when we dispatch your trip, shortly before pickup.</Text>
        </View>

        {submitError && (
          <View style={styles.errRow}><AlertTriangle size={16} color={Colors.error} strokeWidth={2} /><Text style={styles.errText}>{submitError}</Text></View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.fareRow}>
          <Text style={styles.fareLabel}>Estimated fare</Text>
          <Text style={styles.fareValue}>{formatNairaWhole(estimate.data?.estimatedFareKobo ?? 0)}</Text>
        </View>
        <PrimaryButton label="Confirm schedule" onPress={onSubmit} loading={create.isPending} disabled={!canSubmit} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.sm },
  section: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.md },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  gridHalf: { width: '48.5%' },
  list: { gap: Spacing.sm },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  placeText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  toggleRow: { padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  toggleRowOn: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  toggleLabel: { ...Typography.labelMd, color: Colors.onSurface },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 4 },
  estimateLoading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  noteCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.tertiaryFixed, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.sm },
  noteText: { ...Typography.labelSm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  errRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  errText: { ...Typography.labelSm, color: Colors.error, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.sm },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fareLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  fareValue: { ...Typography.headlineMd, color: Colors.primary, fontWeight: '800' as const },
});
