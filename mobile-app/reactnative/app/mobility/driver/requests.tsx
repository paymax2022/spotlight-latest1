import React, { useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MapPin, Navigation2, Star } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TripRouteCard from '@/features/mobility/components/TripRouteCard';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import FareOfferSheet from '@/features/mobility/components/FareOfferSheet';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useDriverRequests, useDriverTrip } from '@/features/mobility/hooks/useMobility';
import { toMobilityError, isFareBoundError, fareBoundMessage, formatNairaWhole, formatDistance, formatDuration } from '@/features/mobility/utils/mobilityFormatters';
import { SERVICE_TYPE_LABEL } from '@/features/mobility/constants/mobility.constants';
import type { DriverRideRequest } from '@/features/mobility/types/mobility.types';

export default function DriverRequestsScreen() {
  const requests = useDriverRequests({ poll: true });
  const { accept, counter } = useDriverTrip();
  const [counterFor, setCounterFor] = useState<DriverRideRequest | null>(null);
  const [counterKobo, setCounterKobo] = useState(0);
  const [counterError, setCounterError] = useState<string | null>(null);

  const onAccept = (req: DriverRideRequest) => {
    accept.mutate(req.tripId, { onSuccess: () => router.push(`/mobility/driver/trip/${req.tripId}`) });
  };

  const openCounter = (req: DriverRideRequest) => {
    setCounterError(null);
    setCounterKobo(req.riderOfferKobo ?? req.systemFareKobo);
    setCounterFor(req);
  };

  const submitCounter = () => {
    if (!counterFor) return;
    setCounterError(null);
    counter.mutate(
      { tripId: counterFor.tripId, counterKobo },
      {
        onSuccess: () => setCounterFor(null),
        onError: (e) => {
          const me = toMobilityError(e);
          setCounterError(isFareBoundError(me) ? fareBoundMessage(me, counterFor.counterMinKobo, counterFor.counterMaxKobo) : me.message);
        },
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Incoming requests" />

      {requests.isLoading ? (
        <StateView kind="loading" message="Finding nearby riders…" />
      ) : requests.isError ? (
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => requests.refetch()} />
      ) : (requests.data?.length ?? 0) === 0 ? (
        <MobilityEdgeState
          kind="empty"
          title="No requests right now"
          message="Stay online — new ride requests near you will appear here."
        />
      ) : counterFor ? (
        <View style={styles.counterScreen}>
          <Text style={styles.counterTitle}>Counter the rider's fare</Text>
          <Text style={styles.counterSub}>
            Rider offered {counterFor.riderOfferKobo != null ? formatNairaWhole(counterFor.riderOfferKobo) : formatNairaWhole(counterFor.systemFareKobo)}
          </Text>
          <FareOfferSheet
            systemFareKobo={counterFor.systemFareKobo}
            offerMinKobo={counterFor.counterMinKobo}
            offerMaxKobo={counterFor.counterMaxKobo}
            value={counterKobo}
            onChange={setCounterKobo}
            error={counterError}
          />
          <View style={styles.counterActions}>
            <PrimaryButton label="Send counter" onPress={submitCounter} loading={counter.isPending} />
            <Pressable onPress={() => setCounterFor(null)} style={styles.cancelBtn}><Text style={styles.cancelLabel}>Cancel</Text></Pressable>
          </View>
        </View>
      ) : (
        <FlatList
          data={requests.data}
          keyExtractor={(r) => r.tripId}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <View style={[styles.card, shadow1]}>
              <View style={styles.cardHead}>
                <View style={styles.riderRow}>
                  <Text style={styles.rider}>{item.rider.name}</Text>
                  <Star size={13} color={Colors.gold} fill={Colors.gold} strokeWidth={0} />
                  <Text style={styles.riderRating}>{item.rider.rating.toFixed(1)}</Text>
                </View>
                <StatusBadge label={item.pricingMode === 'offer' ? 'Offer' : 'Instant'} tone={item.pricingMode === 'offer' ? 'warning' : 'info'} />
              </View>

              <View style={styles.pickupMeta}>
                <Navigation2 size={14} color={Colors.secondary} strokeWidth={2} />
                <Text style={styles.pickupText}>{formatDistance(item.pickupDistanceM)} to pickup</Text>
                <View style={styles.dot} />
                <MapPin size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
                <Text style={styles.pickupText}>{formatDistance(item.distanceM)} · {formatDuration(item.durationS)}</Text>
              </View>

              <TripRouteCard pickup={item.pickup} dest={item.dest} compact />

              <View style={styles.fareRow}>
                <View>
                  <Text style={styles.fareLabel}>{item.pricingMode === 'offer' ? 'Rider offer' : 'Fare'}</Text>
                  <Text style={styles.fareValue}>{formatNairaWhole(item.riderOfferKobo ?? item.systemFareKobo)}</Text>
                </View>
                <View style={styles.netCol}>
                  <Text style={styles.fareLabel}>You earn (net)</Text>
                  <Text style={styles.netValue}>{formatNairaWhole(item.estDriverNetKobo)}</Text>
                </View>
                <Text style={styles.serviceTag}>{SERVICE_TYPE_LABEL[item.serviceType]}</Text>
              </View>

              <View style={styles.actions}>
                {item.pricingMode === 'offer' && (
                  <Pressable style={styles.counterBtn} onPress={() => openCounter(item)}>
                    <Text style={styles.counterBtnLabel}>Counter</Text>
                  </Pressable>
                )}
                <View style={{ flex: 1 }}>
                  <PrimaryButton label="Accept" onPress={() => onAccept(item)} loading={accept.isPending} />
                </View>
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.outlineVariant, gap: Spacing.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  riderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rider: { ...Typography.titleMd, color: Colors.onSurface },
  riderRating: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  pickupMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  pickupText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: Colors.outline },
  fareRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md },
  fareLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  fareValue: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' as const },
  netCol: {},
  netValue: { ...Typography.titleMd, color: Colors.tertiaryContainer, fontWeight: '700' as const },
  serviceTag: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginLeft: 'auto' },
  actions: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  counterBtn: { paddingHorizontal: Spacing.lg, height: 56, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.secondary, alignItems: 'center', justifyContent: 'center' },
  counterBtnLabel: { ...Typography.labelLg, color: Colors.secondary },
  counterScreen: { padding: Spacing.containerMargin, gap: Spacing.lg },
  counterTitle: { ...Typography.titleLg, color: Colors.onSurface },
  counterSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginTop: -Spacing.sm },
  counterActions: { gap: Spacing.sm },
  cancelBtn: { height: 48, alignItems: 'center', justifyContent: 'center' },
  cancelLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
});
