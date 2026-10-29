import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Info, Minus, Plus } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow2 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import ModalSheet from '@/components/ModalSheet';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { RatePlanCard } from '@/features/stays/components';
import { useProperty, useRoomTypes } from '@/features/stays/hooks';
import { useStaysStore } from '@/features/stays/store';
import {
  formatNaira, chargeableKobo, longStayDiscountKobo, nightsBetween, formatShortDate, BOARD_LABEL,
} from '@/features/stays/constants/stays.constants';
import type { BookingDraft, RatePlan } from '@/features/stays/types';

const MIN_NIGHTS = 1;
const MAX_NIGHTS = 30;

// Date arithmetic at noon local time, so a timezone offset cannot shift the calendar day.
function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function RatesScreen() {
  const { id, roomTypeId } = useLocalSearchParams<{ id: string; roomTypeId: string }>();
  const prop = useProperty(String(id));
  const { query, setDraft, setQuery } = useStaysStore();
  const nights = nightsBetween(query.checkIn, query.checkOut);
  // Prices are per stay, so the rooms are fetched for the length the guest picked here.
  const rooms = useRoomTypes(String(id), { checkIn: query.checkIn, checkOut: query.checkOut });
  const [selected, setSelected] = useState<string | null>(null);

  const room = useMemo(() => rooms.data?.find((r) => r.id === roomTypeId) ?? rooms.data?.[0], [rooms.data, roomTypeId]);
  const plans = room?.ratePlans ?? [];
  const plan = plans.find((p) => p.id === selected) ?? null;

  // Room total for the stay: nightly rate × nights, less the creator's long-stay discount.
  const roomGrossKobo = (rp: RatePlan) => chargeableKobo(rp.pricePerNightMinor, rp.currency) * nights;
  const longStayOff = (rp: RatePlan) => longStayDiscountKobo(roomGrossKobo(rp), nights, rp.longStayMinNights, rp.longStayDiscountPct);
  const stayTotalKobo = (rp: RatePlan) => roomGrossKobo(rp) - longStayOff(rp);

  // A new length reprices every plan, so the current selection is cleared.
  const changeNights = (next: number) => {
    const clamped = Math.min(MAX_NIGHTS, Math.max(MIN_NIGHTS, next));
    setQuery({ checkOut: shiftDate(query.checkIn, clamped) });
    setSelected(null);
  };

  const proceed = () => {
    if (!room || !plan || !prop.data) return;
    const draft: BookingDraft = {
      propertyId: prop.data.id,
      propertyName: prop.data.name,
      coverUrl: prop.data.coverUrl,
      city: prop.data.city,
      roomTypeId: room.id,
      roomTypeName: room.name,
      ratePlanId: plan.id,
      ratePlanName: plan.name,
      board: plan.board,
      refundable: plan.refundable,
      freeCancelUntil: plan.freeCancelUntil,
      checkIn: query.checkIn,
      checkOut: query.checkOut,
      nights,
      longStayMinNights: plan.longStayMinNights,
      longStayDiscountPct: plan.longStayDiscountPct,
      guests: query.guests,
      pricePerNightMinor: plan.pricePerNightMinor,
      currency: plan.currency,
      sourceRail: prop.data.sourceRail,
    };
    setDraft(draft);
    router.push('/stays/book/review');
  };

  return (
    <ModalSheet fallback={`/stays/property/${id}`}>
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Rate plans" subtitle={room?.name} showBack />
      {rooms.isLoading || prop.isLoading ? (
        <StateView kind="loading" message="Loading rates…" />
      ) : rooms.isError || !room ? (
        rooms.isError ? (
          <StateView kind="error" title="Couldn't load rates" actionLabel="Retry" onAction={() => rooms.refetch()} />
        ) : (
          <StateView kind="empty" icon="BedDouble" title="Not available for these dates" message="Pick other dates to see rates." />
        )
      ) : (
        <>
          <View style={styles.compareHint}>
            <Info size={14} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.compareText}>Compare refundable, non-refundable, breakfast & mobile rates</Text>
          </View>
          <View style={styles.stayRow}>
            <Pressable style={{ flex: 1 }} onPress={() => router.push('/stays/dates')} accessibilityLabel="Change check-in date">
              <Text style={styles.stayLabel}>Check-in {formatShortDate(query.checkIn)}</Text>
              <Text style={styles.stayDates}>
                Check-out {formatShortDate(query.checkOut)} · change dates
              </Text>
            </Pressable>
            <View style={styles.stepper}>
              <Pressable
                style={[styles.stepBtn, nights <= MIN_NIGHTS && styles.stepBtnDisabled]}
                disabled={nights <= MIN_NIGHTS}
                onPress={() => changeNights(nights - 1)}
                accessibilityLabel="Remove a night"
              >
                <Minus size={16} color={Colors.primary} strokeWidth={2.5} />
              </Pressable>
              <Text style={styles.stepValue}>
                {nights} night{nights > 1 ? 's' : ''}
              </Text>
              <Pressable
                style={[styles.stepBtn, nights >= MAX_NIGHTS && styles.stepBtnDisabled]}
                disabled={nights >= MAX_NIGHTS}
                onPress={() => changeNights(nights + 1)}
                accessibilityLabel="Add a night"
              >
                <Plus size={16} color={Colors.primary} strokeWidth={2.5} />
              </Pressable>
            </View>
          </View>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <Pressable
              style={styles.roomLink}
              onPress={() => router.push({ pathname: `/stays/property/${id}/room-detail`, params: { roomTypeId: room.id } })}
            >
              <Text style={styles.roomLinkText}>View room photos & occupancy</Text>
            </Pressable>
            {plans.map((rp: RatePlan) => (
              <View key={rp.id} style={{ marginBottom: Spacing.md }}>
                <RatePlanCard plan={rp} selected={selected === rp.id} onSelect={() => setSelected(rp.id)} />
                {rp.longStayMinNights && rp.longStayDiscountPct ? (
                  <Text style={styles.ruleText}>
                    {rp.longStayDiscountPct}% off when you stay {rp.longStayMinNights}+ nights
                    {longStayOff(rp) > 0 ? ` · you save ${formatNaira(longStayOff(rp))}` : ''}
                  </Text>
                ) : null}
                {selected === rp.id ? (
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>{nights} night{nights > 1 ? 's' : ''} · {BOARD_LABEL[rp.board]}</Text>
                    <Text style={styles.totalVal}>{formatNaira(stayTotalKobo(rp))}</Text>
                  </View>
                ) : null}
              </View>
            ))}
          </ScrollView>

          {plan ? (
            <View style={styles.footer}>
              <View style={{ flex: 1 }}>
                <Text style={styles.footerLabel}>Total ({nights} night{nights > 1 ? 's' : ''})</Text>
                <Text style={styles.footerPrice}>{formatNaira(stayTotalKobo(plan))}</Text>
              </View>
              <View style={{ width: 160 }}>
                <PrimaryButton label="Reserve" onPress={proceed} />
              </View>
            </View>
          ) : null}
        </>
      )}
    </SafeAreaView>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  compareHint: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginHorizontal: Spacing.containerMargin, backgroundColor: Colors.iconBgBlue, borderRadius: Radius.md, padding: Spacing.sm, marginBottom: Spacing.sm },
  compareText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  stayRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow },
  stayLabel: { ...Typography.labelMd, color: Colors.onSurface },
  stayDates: { ...Typography.caption, color: Colors.onSurfaceVariant },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  stepBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.outlineVariant },
  stepBtnDisabled: { opacity: 0.4 },
  stepValue: { ...Typography.labelMd, color: Colors.onSurface, minWidth: 64, textAlign: 'center' },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg },
  roomLink: { paddingVertical: Spacing.sm, marginBottom: Spacing.xs },
  roomLinkText: { ...Typography.labelMd, color: Colors.secondary },
  ruleText: { ...Typography.caption, color: Colors.secondary, marginTop: 4, paddingHorizontal: Spacing.md },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderBottomLeftRadius: Radius.lg, borderBottomRightRadius: Radius.lg, marginTop: -Spacing.xs },
  totalLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  totalVal: { ...Typography.titleMd, color: Colors.primary, fontWeight: '700' as const },
  footer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, ...shadow2 },
  footerLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  footerPrice: { ...Typography.titleLg, color: Colors.onSurface },
});
