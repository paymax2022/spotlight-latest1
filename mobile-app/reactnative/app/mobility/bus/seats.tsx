import React, { useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Armchair, RefreshCcw, Ban, AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import SegmentedControl from '@/components/SegmentedControl';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import {
  useBusDeparture,
  useBusDraft,
  useCreateBusHold,
} from '@/features/mobility/hooks/useBusV2';
import { legForDirection, upsertBusDraftLeg } from '@/features/mobility/utils/busCheckoutDraft';
import {
  alightableStops,
  boardableStops,
  busDepartureErrKind,
  fareForSegment,
  holdCountdownCopy,
  isSeatConflict,
  parseBusV2Error,
  seatStatusForSegment,
  segmentStopNames,
} from '@/features/mobility/utils/busV2';
import { formatNairaWhole, newIdempotencyKey } from '@/features/mobility/utils/mobilityFormatters';
import type {
  BusLegDirection,
  BusSeatCell,
  BusSeatStatus,
} from '@/features/mobility/types/busV2.types';

/**
 * Segment-aware seat picker for ONE departure leg.
 * Params: departureId, direction ('outbound'|'return'), optional pax override.
 *
 * Board/alight pickers appear whenever the route has intermediate stops; the
 * seat map re-derives availability for the chosen [fromSeq,toSeq) segment from
 * the server's occupancy intervals. Confirming creates a seat hold (TTL) and
 * either returns to results (return leg still needed) or proceeds to
 * passengers.
 */
export default function BusSeatsScreen() {
  const params = useLocalSearchParams<{ departureId?: string; direction?: string; pax?: string }>();
  const departureId = String(params.departureId ?? '');
  const direction: BusLegDirection = params.direction === 'return' ? 'return' : 'outbound';
  const draft = useBusDraft();
  const pax = Math.max(1, Number(params.pax) || draft?.search.pax || 1);

  const detail = useBusDeparture(departureId);
  const createHold = useCreateBusHold();

  const [fromSeq, setFromSeq] = useState<number | null>(null);
  const [toSeq, setToSeq] = useState<number | null>(null);
  const [deck, setDeck] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [heldFor, setHeldFor] = useState<string | null>(null); // leg already held

  // One idempotency key per selection signature — a retried hold replays, it
  // never duplicates. Signature changes (seats/segment) mint a fresh key.
  const idemRef = useRef<{ sig: string; key: string } | null>(null);

  const d = detail.data;
  const boardOptions = useMemo(() => (d ? boardableStops(d.stops) : []), [d]);
  const effFromSeq = fromSeq ?? boardOptions[0]?.seq ?? 0;
  const alightOptions = useMemo(
    () => (d ? alightableStops(d.stops, effFromSeq) : []),
    [d, effFromSeq],
  );
  const effToSeq = toSeq ?? alightOptions[alightOptions.length - 1]?.seq ?? 0;
  const multiStop = boardOptions.length > 1 || alightOptions.length > 1;

  const perSeatKobo = d ? fareForSegment(d.odFares, effFromSeq, effToSeq) : null;
  const fareUnavailable = Boolean(d) && perSeatKobo == null;

  // Status for every cell under the current segment.
  const statusBySeat = useMemo(() => {
    const m = new Map<string, Exclude<BusSeatStatus, 'selected'>>();
    if (!d) return m;
    for (const c of d.layout.cells) m.set(c.seatId, seatStatusForSegment(c, d.occupancy, effFromSeq, effToSeq));
    return m;
  }, [d, effFromSeq, effToSeq]);

  // Drop selections that a refresh just made unavailable (conflict messaging).
  const lostCount = selected.filter((id) => statusBySeat.get(id) !== 'available').length;
  React.useEffect(() => {
    if (lostCount > 0) {
      setSelected((sel) => sel.filter((id) => statusBySeat.get(id) === 'available'));
      setNotice('Some seats were just taken — your selection was updated.');
    }
  }, [statusBySeat, lostCount]);

  const toggleSeat = (cell: BusSeatCell) => {
    const st = statusBySeat.get(cell.seatId);
    if (st !== 'available') return;
    setNotice(null);
    setSelected((sel) => {
      if (sel.includes(cell.seatId)) return sel.filter((x) => x !== cell.seatId);
      if (sel.length >= pax) {
        setNotice(`You picked ${pax} seat${pax === 1 ? '' : 's'} — that's one per passenger. Deselect one to change it.`);
        return sel;
      }
      return [...sel, cell.seatId];
    });
  };

  const canHold = selected.length === pax && !fareUnavailable && !createHold.isPending;

  const onHold = () => {
    if (!d || !canHold) return;
    const sig = `${departureId}|${effFromSeq}-${effToSeq}|${[...selected].sort().join(',')}`;
    if (idemRef.current?.sig !== sig) idemRef.current = { sig, key: newIdempotencyKey('bus-hold') };
    createHold.mutate(
      { departureId, seatIds: selected, fromSeq: effFromSeq, toSeq: effToSeq, idempotencyKey: idemRef.current.key },
      {
        onSuccess: (hold) => {
          const labels = selected.map(
            (id) => d.layout.cells.find((c) => c.seatId === id)?.label ?? id,
          );
          const stopNames = segmentStopNames(d.stops, effFromSeq, effToSeq);
          upsertBusDraftLeg({
            direction,
            departureId,
            seatIds: [...selected],
            seatLabels: labels,
            fromSeq: effFromSeq,
            toSeq: effToSeq,
            holdId: hold.holdId,
            holdExpiresAt: hold.expiresAt,
            summary: {
              operatorName: d.operator.name,
              routeLabel: stopNames.join(' → ') || `${d.stops[0]?.name ?? ''} → ${d.stops[d.stops.length - 1]?.name ?? ''}`,
              vehicleClass: d.vehicleClass,
              boardingAt: d.boardingAt,
              departureAt: d.departureAt,
              fromStopName: d.stops.find((s) => s.seq === effFromSeq)?.name ?? '',
              toStopName: d.stops.find((s) => s.seq === effToSeq)?.name ?? '',
              fareKobo: perSeatKobo ?? 0,
            },
          });
          setHeldFor(hold.holdId);
          const needsReturn = draft?.search.tripType === 'return' && !legForDirection('return') && direction !== 'return';
          if (needsReturn) router.back();
          else router.push('/mobility/bus/passenger');
        },
        onError: (e) => {
          const { message } = parseBusV2Error(e);
          if (isSeatConflict(e)) {
            setNotice(`${message} Refreshing the seat map…`);
            detail.refetch();
          } else {
            setNotice(message);
          }
        },
      },
    );
  };

  // Group layout cells by deck → row for rendering.
  const decks = useMemo(() => {
    if (!d) return [];
    const out: { deck: number; rows: (BusSeatCell | null)[][] }[] = [];
    for (let dk = 1; dk <= Math.max(1, d.layout.decks); dk++) {
      const rows: (BusSeatCell | null)[][] = [];
      for (let r = 1; r <= d.layout.rows; r++) {
        const row: (BusSeatCell | null)[] = [];
        for (let c = 1; c <= d.layout.cols; c++) {
          row.push(d.layout.cells.find((x) => x.deck === dk && x.row === r && x.col === c) ?? null);
        }
        rows.push(row);
      }
      out.push({ deck: dk, rows });
    }
    return out;
  }, [d]);
  const activeDeck = decks.find((x) => x.deck === deck) ?? decks[0];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title={direction === 'return' ? 'Return · choose seats' : 'Choose your seats'}
        subtitle={d ? `${d.operator.name} · ${d.vehicleClass}` : undefined}
      />
      {detail.isLoading ? (
        <StateView kind="loading" message="Loading seat map…" />
      ) : detail.isError || !d ? (
        <MobilityEdgeState kind={busDepartureErrKind(detail.error)} actionLabel="Retry" onAction={() => detail.refetch()} />
      ) : (
        <>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scroll}
            refreshControl={
              <RefreshControl refreshing={detail.isRefetching} onRefresh={() => detail.refetch()} tintColor={Colors.primary} />
            }
          >
            {/* Segment pickers — only when the route actually has choices */}
            {multiStop ? (
              <View style={styles.segmentCard}>
                <SelectField
                  label="Boarding at"
                  value={d.stops.find((s) => s.seq === effFromSeq)?.name ?? ''}
                  options={boardOptions.map((s) => s.name)}
                  onChange={(name) => {
                    const s = boardOptions.find((x) => x.name === name);
                    if (!s) return;
                    setFromSeq(s.seq);
                    setSelected([]);
                    // Alight must be after board — reset when it isn't.
                    if (toSeq != null && toSeq <= s.seq) setToSeq(null);
                  }}
                />
                <SelectField
                  label="Alighting at"
                  value={d.stops.find((s) => s.seq === effToSeq)?.name ?? ''}
                  options={alightOptions.map((s) => s.name)}
                  onChange={(name) => {
                    const s = alightOptions.find((x) => x.name === name);
                    if (!s) return;
                    setToSeq(s.seq);
                    setSelected([]);
                  }}
                />
                <Text style={styles.segmentNote}>Fares and seat availability are per segment — seats taken on part of the trip stay open on yours.</Text>
              </View>
            ) : (
              <Text style={styles.segmentNote}>
                {d.stops[0]?.name ?? ''} → {d.stops[d.stops.length - 1]?.name ?? ''}
              </Text>
            )}

            {/* Legend — every seat state a customer can see */}
            <View style={styles.legend}>
              <Legend swatch={[styles.swAvailable]} label="Available" />
              <Legend swatch={[styles.swSelected]} label="Selected" />
              <Legend swatch={[styles.swHeld]} label="Held" />
              <Legend swatch={[styles.swBooked]} label="Booked" />
              <Legend swatch={[styles.swBlocked]} label="Blocked" />
            </View>

            {decks.length > 1 ? (
              <SegmentedControl
                value={String(deck)}
                onChange={(v) => setDeck(Number(v))}
                options={decks.map((x) => ({ value: String(x.deck), label: x.deck === 1 ? 'Lower deck' : 'Upper deck' }))}
              />
            ) : null}

            {notice ? (
              <View style={styles.noticeRow}>
                <AlertTriangle size={14} color={Colors.onWarning} strokeWidth={2.2} />
                <Text style={styles.noticeText}>{notice}</Text>
              </View>
            ) : null}

            <View style={styles.busShell}>
              <View style={styles.shellHead}>
                <Text style={styles.driverLabel}>Front · Driver</Text>
                <Pressable
                  onPress={() => detail.refetch()}
                  hitSlop={8}
                  style={styles.refreshBtn}
                  accessibilityLabel="Refresh seat availability"
                  accessibilityRole="button"
                >
                  <RefreshCcw size={13} color={Colors.secondary} strokeWidth={2.2} />
                  <Text style={styles.refreshText}>Refresh</Text>
                </Pressable>
              </View>
              {activeDeck?.rows.map((row, ri) => (
                <View key={ri} style={styles.seatRow}>
                  {row.map((cell, ci) => {
                    const seat = cell ?? null;
                    const st = seat ? statusBySeat.get(seat.seatId) ?? 'blocked' : 'blocked';
                    const isSel = seat ? selected.includes(seat.seatId) : false;
                    const isSeat = seat && seat.kind !== 'empty' && seat.kind !== 'driver';
                    return (
                      <React.Fragment key={`${ri}-${ci}`}>
                        {isSeat ? (
                          <Pressable
                            style={[
                              styles.seat,
                              st === 'held' && styles.seatHeld,
                              st === 'booked' && styles.seatBooked,
                              st === 'blocked' && styles.seatBlocked,
                              isSel && styles.seatSelected,
                            ]}
                            disabled={st !== 'available' && !isSel}
                            onPress={() => toggleSeat(seat)}
                            accessibilityRole="button"
                            accessibilityState={{ selected: isSel, disabled: st !== 'available' && !isSel }}
                            accessibilityLabel={`Seat ${seat.label}, ${isSel ? 'selected' : st}`}
                          >
                            <Armchair
                              size={18}
                              color={
                                isSel
                                  ? Colors.onPrimary
                                  : st === 'available'
                                    ? Colors.onSurfaceVariant
                                    : st === 'held'
                                      ? Colors.onWarning
                                      : Colors.outline
                              }
                              strokeWidth={2}
                            />
                            <Text style={[styles.seatNum, isSel && styles.seatNumSelected]}>{seat.label}</Text>
                          </Pressable>
                        ) : (
                          <View style={styles.seatSpacer} accessibilityElementsHidden>
                            {seat?.kind === 'driver' ? <Ban size={14} color={Colors.outline} /> : null}
                          </View>
                        )}
                        {d.layout.aisleAfterCol.includes(ci + 1) ? <View style={styles.aisle} /> : null}
                      </React.Fragment>
                    );
                  })}
                </View>
              ))}
            </View>

            {fareUnavailable ? (
              <Text style={styles.fareErr}>No fare is published for this segment yet. Pick another stop pair or departure.</Text>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.fareRow}>
              <View>
                <Text style={styles.fareLabel}>
                  {selected.length
                    ? `${selected.length}/${pax} seats · ${selected.map((id) => d.layout.cells.find((c) => c.seatId === id)?.label ?? id).join(', ')}`
                    : `Pick ${pax} seat${pax === 1 ? '' : 's'}`}
                </Text>
                {heldFor ? <Text style={styles.holdText}>{holdCountdownCopy(detail.data ? (legForDirection(direction)?.holdExpiresAt ?? null) : null)}</Text> : null}
              </View>
              <Text style={styles.fareValue}>
                {perSeatKobo != null ? formatNairaWhole(perSeatKobo * Math.max(1, selected.length)) : '—'}
              </Text>
            </View>
            <PrimaryButton
              label={createHold.isPending ? 'Holding seats…' : 'Hold seats & continue'}
              onPress={onHold}
              loading={createHold.isPending}
              disabled={!canHold}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function Legend({ swatch, label }: { swatch: object[]; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, ...swatch]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.md },
  segmentCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  segmentNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 16, height: 16, borderRadius: 4, borderWidth: 1.5 },
  legendLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  noticeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgGold, borderRadius: Radius.md, padding: Spacing.sm },
  noticeText: { ...Typography.labelSm, color: Colors.onWarning, flex: 1 },
  busShell: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.outlineVariant, gap: Spacing.sm },
  shellHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  driverLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  refreshText: { ...Typography.labelSm, color: Colors.secondary, fontWeight: '700' as const },
  seatRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.sm },
  seat: { width: 52, height: 52, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.outlineVariant, alignItems: 'center', justifyContent: 'center' },
  seatSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  seatHeld: { backgroundColor: Colors.iconBgGold, borderColor: Colors.gold },
  seatBooked: { backgroundColor: Colors.surfaceContainerHigh, borderColor: Colors.surfaceContainerHigh },
  seatBlocked: { backgroundColor: Colors.iconBgRed, borderColor: Colors.iconBgRed },
  seatSpacer: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  seatNum: { ...Typography.caption, color: Colors.onSurfaceVariant },
  seatNumSelected: { color: Colors.onPrimary },
  aisle: { width: Spacing.md },
  swAvailable: { backgroundColor: Colors.surfaceContainerLow, borderColor: Colors.outlineVariant },
  swSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  swHeld: { backgroundColor: Colors.iconBgGold, borderColor: Colors.gold },
  swBooked: { backgroundColor: Colors.surfaceContainerHigh, borderColor: Colors.surfaceContainerHigh },
  swBlocked: { backgroundColor: Colors.iconBgRed, borderColor: Colors.iconBgRed },
  fareErr: { ...Typography.labelSm, color: Colors.error, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.sm },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fareLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, flexShrink: 1 },
  fareValue: { ...Typography.headlineMd, color: Colors.primary, fontWeight: '800' as const },
  holdText: { ...Typography.caption, color: Colors.secondary, marginTop: 2 },
});
