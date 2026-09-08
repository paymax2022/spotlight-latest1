import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Navigation2, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import MobilityMap from '@/features/mobility/components/MobilityMap';
import TripRouteCard from '@/features/mobility/components/TripRouteCard';
import TripPinInput from '@/features/mobility/components/TripPinInput';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import SafetyButton from '@/features/mobility/components/SafetyButton';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useTrip, useDriverTrip } from '@/features/mobility/hooks/useMobility';
import { useTripRealtime } from '@/features/mobility/hooks/useTripRealtime';
import { driverSos } from '@/features/mobility/api/mobility.api';
import { toMobilityError, formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import type { TripPhase } from '@/features/mobility/types/mobility.types';

// The driver-side trip advances locally as the driver taps each action.
type DriverPhase = 'driver_assigned' | 'driver_arriving' | 'pin_verified' | 'in_progress' | 'completed';

export default function DriverTripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = useTrip(id);
  const { arrive, verifyPin, start, complete } = useDriverTrip();

  const [phase, setPhase] = useState<DriverPhase>('driver_assigned');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [completedFare, setCompletedFare] = useState<number | null>(null);

  const t = trip.data;
  // Live position over the trip WebSocket (the driver app feeds GPS upstream).
  // Polling/local phase remains the fallback when realtime is unavailable.
  const realtime = useTripRealtime(id, { phase });

  const onArrive = () => id && arrive.mutate(id, { onSuccess: () => setPhase('driver_arriving') });
  const onVerify = () => {
    if (!id) return;
    setPinError(null);
    verifyPin.mutate(
      { tripId: id, pin },
      {
        onSuccess: () => setPhase('pin_verified'),
        onError: (e) => setPinError(toMobilityError(e).message),
      },
    );
  };
  const onStart = () => id && start.mutate(id, { onSuccess: () => setPhase('in_progress') });
  const onComplete = () => id && complete.mutate(id, {
    onSuccess: (done) => { setCompletedFare(done.fareKobo); setPhase('completed'); },
  });
  const onSos = async () => {
    await driverSos({ lat: 6.45, lng: 3.46 }, id);
    Alert.alert('SOS sent', 'Paymax safety has been alerted.');
  };

  if (trip.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Trip" />
        <StateView kind="loading" message="Loading trip…" />
      </SafeAreaView>
    );
  }
  if (trip.isError || !t) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Trip" />
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => trip.refetch()} />
      </SafeAreaView>
    );
  }

  // Completed earnings screen
  if (phase === 'completed') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Trip completed" showBack={false} />
        <View style={styles.doneBody}>
          <View style={styles.doneIcon}><CheckCircle2 size={40} color={Colors.tertiaryContainer} strokeWidth={2} /></View>
          <Text style={styles.doneTitle}>Trip completed</Text>
          <Text style={styles.doneFare}>{formatNairaWhole(completedFare ?? t.fareKobo)}</Text>
          <Text style={styles.doneSub}>Fare settled. Your share (after commission) has been added to your wallet.</Text>
          <View style={styles.doneActions}>
            <PrimaryButton label="Next request" onPress={() => router.replace('/mobility/driver/requests')} />
            <PrimaryButton label="Driver home" variant="secondary" onPress={() => router.replace('/mobility/driver')} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const displayPhase: TripPhase = phase;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Active trip" showBack={false} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <MobilityMap
          height={200}
          showRoute
          pickup={t.pickup}
          dropoff={t.dest}
          driver={realtime.driver}
          route={realtime.route}
          caption={phase === 'in_progress' ? 'Heading to destination' : 'Navigate to pickup'}
        />

        <StatusBadge phase={displayPhase} />

        <View style={[styles.card, shadow1]}>
          <TripRouteCard pickup={t.pickup} dest={t.dest} />
        </View>

        <View style={[styles.fareCard, shadow1]}>
          <Text style={styles.fareLabel}>Agreed fare</Text>
          <Text style={styles.fareValue}>{formatNairaWhole(t.fareKobo)}</Text>
          <Text style={styles.fareMeta}>{t.pricingMode === 'offer' ? 'Negotiated offer' : 'Instant fare'} · {t.paymentMethod}</Text>
        </View>

        {/* Verify PIN step */}
        {phase === 'driver_arriving' && (
          <View style={[styles.card, shadow1]}>
            <Text style={styles.pinTitle}>Verify rider's trip PIN</Text>
            <Text style={styles.pinSub}>Ask the rider for their 4-digit PIN before starting.</Text>
            <View style={styles.pinWrap}>
              <TripPinInput value={pin} onChange={(v) => { setPin(v); setPinError(null); }} error={pinError ?? undefined} autoFocus />
            </View>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <SafetyButton onSos={onSos} variant="bar" />
        {phase === 'driver_assigned' && (
          <PrimaryButton label="I've arrived at pickup" onPress={onArrive} loading={arrive.isPending} />
        )}
        {phase === 'driver_arriving' && (
          <PrimaryButton label="Verify PIN & continue" onPress={onVerify} loading={verifyPin.isPending} disabled={pin.length !== 4} />
        )}
        {phase === 'pin_verified' && (
          <PrimaryButton label="Start trip" onPress={onStart} loading={start.isPending} />
        )}
        {phase === 'in_progress' && (
          <PrimaryButton label="Complete trip" onPress={onComplete} loading={complete.isPending} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.lg },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.outlineVariant },
  fareCard: { backgroundColor: Colors.primaryFixed, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  fareLabel: { ...Typography.labelSm, color: Colors.onPrimaryFixedVariant },
  fareValue: { ...Typography.headlineMd, color: Colors.primary, fontWeight: '800' as const, marginTop: 2 },
  fareMeta: { ...Typography.labelSm, color: Colors.onPrimaryFixedVariant, marginTop: 2 },
  pinTitle: { ...Typography.titleMd, color: Colors.onSurface },
  pinSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 4, marginBottom: Spacing.md },
  pinWrap: { marginTop: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.sm },
  doneBody: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg, gap: Spacing.sm },
  doneIcon: { width: 76, height: 76, borderRadius: 38, backgroundColor: Colors.tertiaryFixed, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  doneTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  doneFare: { ...Typography.displayLg, fontSize: 40, letterSpacing: -0.8, lineHeight: 46, color: Colors.primary, fontWeight: '800' as const },
  doneSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 22, marginBottom: Spacing.lg },
  doneActions: { width: '100%', gap: Spacing.sm },
});
