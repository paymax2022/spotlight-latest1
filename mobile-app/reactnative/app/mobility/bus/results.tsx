import React, { useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Star, Clock, LogIn, CheckCircle2, RefreshCcw } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { errKind } from '@/features/mobility/utils/errKind';
import { useBusDepartureSearch, useBusDraft, useReleaseBusHold } from '@/features/mobility/hooks/useBusV2';
import { missingLegs, removeBusDraftLeg, startBusDraft } from '@/features/mobility/utils/busCheckoutDraft';
import { holdCountdownCopy } from '@/features/mobility/utils/busV2';
import { formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import type { BusDepartureSummary, BusLegDirection, BusV2SearchParams } from '@/features/mobility/types/busV2.types';
import type { BusDraftLeg } from '@/features/mobility/utils/busCheckoutDraft';

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
const day = (iso: string) => new Date(iso).toLocaleString('en-NG', { day: '2-digit', month: 'short' });

/**
 * Results for the active search — grouped into OUTBOUND and (for return trips)
 * RETURN sections. Selecting a departure moves to the segment-aware seat map;
 * a held leg can be changed (releases its hold) before continuing.
 * Deep-linkable: with no draft, complete route params seed one.
 */
export default function BusResultsScreen() {
  const params = useLocalSearchParams<{
    fromStateId?: string; toStateId?: string; fromCityId?: string; toCityId?: string;
    fromState?: string; toState?: string; fromCity?: string; toCity?: string;
    date?: string; returnDate?: string; pax?: string; tripType?: string;
  }>();
  const draft = useBusDraft();

  // Seed a draft from deep-link params when none exists (web refresh / e2e).
  useEffect(() => {
    if (draft || !params.fromStateId || !params.toStateId || !params.date) return;
    startBusDraft({
      fromStateId: String(params.fromStateId),
      toStateId: String(params.toStateId),
      fromCityId: params.fromCityId ? String(params.fromCityId) : undefined,
      toCityId: params.toCityId ? String(params.toCityId) : undefined,
      fromState: params.fromState ? String(params.fromState) : undefined,
      toState: params.toState ? String(params.toState) : undefined,
      fromCity: params.fromCity ? String(params.fromCity) : undefined,
      toCity: params.toCity ? String(params.toCity) : undefined,
      date: String(params.date),
      pax: Math.max(1, Number(params.pax) || 1),
      tripType: params.tripType === 'return' ? 'return' : 'oneway',
      returnDate: params.returnDate ? String(params.returnDate) : undefined,
    } satisfies BusV2SearchParams);
  }, [draft, params]);

  const search = useBusDepartureSearch(draft?.search ?? null);
  const releaseHold = useReleaseBusHold();

  const missing = missingLegs(draft);
  const outboundLeg = draft?.legs.find((l) => l.direction === 'outbound') ?? null;
  const returnLeg = draft?.legs.find((l) => l.direction === 'return') ?? null;

  const title = draft?.search
    ? `${draft.search.fromCity || draft.search.fromState || '—'} → ${draft.search.toCity || draft.search.toState || '—'}`
    : 'Available buses';

  const onPickDeparture = (dep: BusDepartureSummary, direction: BusLegDirection) => {
    router.push({
      pathname: '/mobility/bus/seats',
      params: { departureId: dep.departureId, direction },
    });
  };

  const onChangeLeg = (leg: BusDraftLeg) => {
    // Best-effort release — the TTL lapses server-side either way.
    releaseHold.mutate(leg.holdId);
    removeBusDraftLeg(leg.direction);
  };

  const renderDeparture = (dep: BusDepartureSummary, direction: BusLegDirection) => {
    const held = direction === 'outbound' ? outboundLeg : returnLeg;
    const isHeldDeparture = held?.departureId === dep.departureId;
    const soldOut = dep.seatsAvailable < (draft?.search.pax ?? 1);
    return (
      <Pressable
        key={dep.departureId}
        style={[styles.tripCard, shadow1, soldOut && !isHeldDeparture && styles.tripCardDisabled, isHeldDeparture && styles.tripCardHeld]}
        disabled={soldOut && !isHeldDeparture}
        onPress={() => onPickDeparture(dep, direction)}
        accessibilityRole="button"
        accessibilityLabel={`${dep.operator.name} departing ${time(dep.departureAt)}, ${dep.seatsAvailable} seats, ${formatNairaWhole(dep.fareKobo)}`}
      >
        <View style={styles.tripHead}>
          <View style={styles.providerChip}>
            <Text style={styles.providerName} numberOfLines={1}>{dep.operator.name}</Text>
            {dep.operator.verified && <StatusBadge label="Verified" tone="success" />}
          </View>
          <View style={styles.ratingRow}>
            <Star size={12} color={Colors.gold} fill={Colors.gold} strokeWidth={0} />
            <Text style={styles.rating}>{dep.operator.ratingAvg.toFixed(1)}</Text>
          </View>
        </View>

        <Text style={styles.routeLine} numberOfLines={1}>{dep.fromStop.name} → {dep.toStop.name}</Text>
        <Text style={styles.terminalLine} numberOfLines={1}>{dep.fromStop.city} → {dep.toStop.city} · {dep.vehicleClass}</Text>

        {/* Boarding and departure are DISTINCT instants — show both, labelled. */}
        <View style={styles.timeRow}>
          {dep.boardingAt ? (
            <View style={styles.timeChip}>
              <LogIn size={12} color={Colors.secondary} strokeWidth={2} />
              <Text style={styles.timeChipText}>Boards {time(dep.boardingAt)}</Text>
            </View>
          ) : null}
          <View style={styles.timeChip}>
            <Clock size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.timeChipText}>Departs {time(dep.departureAt)}</Text>
          </View>
        </View>

        {dep.amenities.length > 0 && (
          <View style={styles.amenityRow}>
            {dep.amenities.slice(0, 3).map((a) => (
              <View key={a} style={styles.amenityPill}><Text style={styles.amenityText}>{a}</Text></View>
            ))}
          </View>
        )}

        <View style={styles.tripFooter}>
          {isHeldDeparture ? (
            <StatusBadge label={`Held · seats ${held!.seatLabels.join(', ')}`} tone="success" />
          ) : soldOut ? (
            <StatusBadge label="Not enough seats" tone="danger" />
          ) : (
            <Text style={styles.seatsLeft}>{dep.seatsAvailable} seats left</Text>
          )}
          <View style={styles.fareCol}>
            <Text style={styles.fromLabel}>per seat</Text>
            <Text style={styles.fare}>{formatNairaWhole(dep.fareKobo)}</Text>
          </View>
        </View>
      </Pressable>
    );
  };

  const renderSection = (
    direction: BusLegDirection,
    heading: string,
    dateIso: string,
    list: BusDepartureSummary[] | undefined,
  ) => {
    const held = direction === 'outbound' ? outboundLeg : returnLeg;
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{heading} · {day(dateIso)}</Text>
        {held ? (
          <View style={[styles.heldCard, shadow1]}>
            <View style={styles.heldHead}>
              <CheckCircle2 size={18} color={Colors.tertiaryContainer} strokeWidth={2.2} />
              <View style={{ flex: 1 }}>
                <Text style={styles.heldTitle}>{held.summary.routeLabel}</Text>
                <Text style={styles.heldMeta}>
                  {held.summary.operatorName} · Departs {time(held.summary.departureAt)} · Seats {held.seatLabels.join(', ')}
                </Text>
                {holdCountdownCopy(held.holdExpiresAt) ? (
                  <Text style={styles.holdHint}>{holdCountdownCopy(held.holdExpiresAt)}</Text>
                ) : null}
              </View>
              <Pressable
                onPress={() => onChangeLeg(held)}
                hitSlop={8}
                style={styles.changeBtn}
                accessibilityLabel={`Change ${direction} leg`}
                accessibilityRole="button"
              >
                <RefreshCcw size={13} color={Colors.secondary} strokeWidth={2.2} />
                <Text style={styles.changeText}>Change</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            {search.isLoading ? (
              <StateView kind="loading" compact message="Finding buses…" />
            ) : search.isError ? (
              <MobilityEdgeState kind={errKind(search.error)} compact actionLabel="Retry" onAction={() => search.refetch()} />
            ) : (list?.length ?? 0) === 0 ? (
              <MobilityEdgeState kind="empty" compact title="No departures" message="No operators run this leg on the selected date." />
            ) : (
              list!.map((d) => renderDeparture(d, direction))
            )}
          </>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={title} subtitle={draft ? `${draft.search.pax} passenger${draft.search.pax === 1 ? '' : 's'}` : undefined} />
      {!draft ? (
        <StateView kind="loading" message="Preparing your search…" />
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            {renderSection('outbound', 'Outbound', draft.search.date, search.data?.outbound)}
            {draft.search.tripType === 'return'
              ? renderSection('return', 'Return', draft.search.returnDate ?? draft.search.date, search.data?.returnLegs)
              : null}
          </ScrollView>
          <View style={styles.footer}>
            <PrimaryButton
              label={missing.length ? `Pick your ${missing[0]} departure` : 'Continue to passengers'}
              onPress={() => router.push('/mobility/bus/passenger')}
              disabled={missing.length > 0}
            />
            <Pressable onPress={() => goBack('/mobility/bus')} accessibilityRole="button">
              <Text style={styles.editSearch}>Edit search</Text>
            </Pressable>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.lg },
  section: { gap: Spacing.sm },
  sectionTitle: { ...Typography.labelLg, color: Colors.onSurface },
  tripCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant, gap: 4 },
  tripCardDisabled: { opacity: 0.55 },
  tripCardHeld: { borderColor: Colors.tertiaryContainer, borderWidth: 1.5 },
  tripHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  providerChip: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  providerName: { ...Typography.labelLg, color: Colors.onSurface, flexShrink: 1 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rating: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  routeLine: { ...Typography.labelLg, color: Colors.onSurface, marginTop: 2 },
  terminalLine: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  timeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  timeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  timeChipText: { ...Typography.caption, color: Colors.onSurfaceVariant, fontWeight: '600' as const },
  amenityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  amenityPill: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  amenityText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  tripFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, paddingTop: Spacing.sm },
  seatsLeft: { ...Typography.labelSm, color: Colors.tertiaryContainer },
  fareCol: { alignItems: 'flex-end' },
  fromLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  fare: { ...Typography.titleMd, color: Colors.primary, fontWeight: '800' as const },
  heldCard: { backgroundColor: Colors.primaryFixed, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  heldHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  heldTitle: { ...Typography.labelLg, color: Colors.onSurface },
  heldMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  holdHint: { ...Typography.caption, color: Colors.secondary, marginTop: 4 },
  changeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4 },
  changeText: { ...Typography.labelSm, color: Colors.secondary, fontWeight: '700' as const },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.sm },
  editSearch: { ...Typography.labelSm, color: Colors.secondary, textAlign: 'center' },
});
