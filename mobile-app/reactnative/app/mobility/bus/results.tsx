import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Star, ChevronRight, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useBusRoutes, useBusSchedules } from '@/features/mobility/hooks/useModes';
import { formatNairaWhole, formatDuration } from '@/features/mobility/utils/mobilityFormatters';
import type { BusRoute, BusSchedule } from '@/features/mobility/types/modes.types';

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });

// A real connectivity drop (no HTTP response) is "offline"; anything the server
// actually answered (404/5xx/parse) is a backend failure, not the user's network.
// Mislabelling the latter as "offline" sends people to check their wifi for nothing.
const errKind = (e: unknown): 'offline' | 'genericError' =>
  (e as { response?: unknown })?.response ? 'genericError' : 'offline';

export default function BusResultsScreen() {
  const { origin = '', dest = '', date = '' } = useLocalSearchParams<{ origin?: string; dest?: string; date?: string }>();
  const routes = useBusRoutes(origin, dest, Boolean(origin && dest));
  const [expandedRoute, setExpandedRoute] = useState<string | null>(null);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={`${origin} → ${dest}`} subtitle={date} />
      {routes.isLoading ? (
        <StateView kind="loading" message="Finding buses…" />
      ) : routes.isError ? (
        <MobilityEdgeState kind={errKind(routes.error)} actionLabel="Retry" onAction={() => routes.refetch()} />
      ) : (routes.data?.length ?? 0) === 0 ? (
        <MobilityEdgeState kind="empty" title="No buses found" message="No operators run this route on the selected date. Try another date or city." actionLabel="Change search" onAction={() => goBack('/mobility/bus')} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {routes.data!.map((r: BusRoute) => (
            <View key={r.id} style={[styles.card, shadow1]}>
              <Pressable style={styles.routeHead} onPress={() => setExpandedRoute((x) => (x === r.id ? null : r.id))}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.operator}>{r.operatorName}</Text>
                  <View style={styles.metaRow}>
                    <Star size={12} color={Colors.gold} fill={Colors.gold} strokeWidth={0} />
                    <Text style={styles.meta}>{r.operatorRating.toFixed(1)}</Text>
                    <View style={styles.dot} />
                    <Clock size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
                    <Text style={styles.meta}>{formatDuration(r.durationS)}</Text>
                  </View>
                  <Text style={styles.terminal} numberOfLines={1}>{r.originTerminal} → {r.destTerminal}</Text>
                </View>
                <View style={styles.priceCol}>
                  <Text style={styles.fromLabel}>from</Text>
                  <Text style={styles.fare}>{formatNairaWhole(r.fromKobo)}</Text>
                </View>
              </Pressable>

              {expandedRoute === r.id && <RouteSchedules routeId={r.id} date={String(date)} />}
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function RouteSchedules({ routeId, date }: { routeId: string; date: string }) {
  const schedules = useBusSchedules(routeId, date);
  if (schedules.isLoading) return <View style={styles.scheduleWrap}><StateView kind="loading" compact message="Loading times…" /></View>;
  if (schedules.isError) return <View style={styles.scheduleWrap}><MobilityEdgeState kind={errKind(schedules.error)} compact actionLabel="Retry" onAction={() => schedules.refetch()} /></View>;
  if ((schedules.data?.length ?? 0) === 0) return <View style={styles.scheduleWrap}><Text style={styles.noTimes}>No departures left today.</Text></View>;

  return (
    <View style={styles.scheduleWrap}>
      {schedules.data!.map((s: BusSchedule) => {
        const soldOut = s.seatsLeft === 0;
        return (
          <Pressable
            key={s.id}
            style={[styles.scheduleRow, soldOut && styles.scheduleRowDisabled]}
            disabled={soldOut}
            onPress={() => router.push({ pathname: '/mobility/bus/seats', params: { scheduleId: s.id } })}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.scheduleTime}>{time(s.departAt)} → {time(s.arriveAt)}</Text>
              <Text style={styles.scheduleType}>{s.busType}</Text>
            </View>
            <View style={styles.scheduleRight}>
              <Text style={styles.scheduleFare}>{formatNairaWhole(s.fareKobo)}</Text>
              {soldOut ? <StatusBadge label="Sold out" tone="danger" /> : <Text style={styles.seatsLeft}>{s.seatsLeft} seats left</Text>}
            </View>
            {!soldOut && <ChevronRight size={18} color={Colors.onSurfaceVariant} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, overflow: 'hidden' },
  routeHead: { flexDirection: 'row', alignItems: 'center', padding: Spacing.md, gap: Spacing.md },
  operator: { ...Typography.labelLg, color: Colors.onSurface },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: Colors.outline },
  terminal: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 4 },
  priceCol: { alignItems: 'flex-end' },
  fromLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  fare: { ...Typography.titleMd, color: Colors.primary, fontWeight: '800' as const },
  scheduleWrap: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant, padding: Spacing.sm, gap: Spacing.sm },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md },
  scheduleRowDisabled: { opacity: 0.55 },
  scheduleTime: { ...Typography.labelMd, color: Colors.onSurface },
  scheduleType: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  scheduleRight: { alignItems: 'flex-end', gap: 2 },
  scheduleFare: { ...Typography.labelLg, color: Colors.onSurface },
  seatsLeft: { ...Typography.caption, color: Colors.tertiaryContainer },
  noTimes: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', paddingVertical: Spacing.md },
});
