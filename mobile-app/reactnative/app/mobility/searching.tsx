import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Animated, Easing, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import MapPlaceholder from '@/features/mobility/components/MapPlaceholder';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useTrip, useCancelRide } from '@/features/mobility/hooks/useMobility';

const SEARCH_TIMEOUT_MS = 35_000;

export default function SearchingScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const trip = useTrip(tripId, { poll: true });
  const cancel = useCancelRide();
  const [timedOut, setTimedOut] = useState(false);

  // Pulse animation
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  // Timeout → no-driver-found
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), SEARCH_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  // Once a driver is assigned, move to the live trip screen.
  useEffect(() => {
    const phase = trip.data?.phase;
    if (phase && phase !== 'requested' && phase !== 'fare_negotiating') {
      if (['cancelled', 'no_show'].includes(phase)) { router.back(); return; }
      router.replace(`/mobility/trip/${tripId}`);
    }
  }, [trip.data?.phase, tripId]);

  const onCancel = () => {
    if (!tripId) return;
    cancel.mutate({ tripId, reason: 'Cancelled while searching' }, { onSuccess: () => router.dismissAll() });
  };

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] });

  if (timedOut) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <MobilityEdgeState
          kind="noDriver"
          actionLabel="Search again"
          onAction={() => { setTimedOut(false); trip.refetch(); }}
        />
        <View style={styles.footer}>
          <PrimaryButton label="Cancel request" variant="secondary" onPress={onCancel} loading={cancel.isPending} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <MapPlaceholder height={220} showRoute style={{ marginHorizontal: Spacing.containerMargin }} />

        <View style={styles.pulseWrap}>
          <Animated.View style={[styles.ripple, { transform: [{ scale }], opacity }]} />
          <View style={styles.core}>
            <ActivityIndicator color={Colors.white} size="large" />
          </View>
        </View>

        <Text style={styles.title}>
          {trip.data?.pricingMode === 'offer' ? 'Sending your offer to drivers…' : 'Finding the best driver near you…'}
        </Text>
        <Text style={styles.subtitle}>This usually takes under a minute.</Text>
      </View>

      <View style={styles.footer}>
        <Pressable onPress={onCancel} disabled={cancel.isPending} style={styles.cancelBtn} accessibilityLabel="Cancel ride request">
          <Text style={styles.cancelLabel}>{cancel.isPending ? 'Cancelling…' : 'Cancel request'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, alignItems: 'center', paddingTop: Spacing.lg, gap: Spacing.lg },
  pulseWrap: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.lg },
  ripple: { position: 'absolute', width: 96, height: 96, borderRadius: 48, backgroundColor: Colors.primary },
  core: { width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center', paddingHorizontal: Spacing.lg },
  subtitle: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, gap: Spacing.sm },
  cancelBtn: { height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow },
  cancelLabel: { ...Typography.labelLg, color: Colors.error },
});
