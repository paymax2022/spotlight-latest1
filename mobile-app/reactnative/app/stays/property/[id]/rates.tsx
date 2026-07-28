import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow2 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { RatePlanCard } from '@/features/stays/components';
import { useProperty, useRoomTypes } from '@/features/stays/hooks';
import { useStaysStore } from '@/features/stays/store';
import {
  formatNaira, chargeableKobo, nightsBetween, BOARD_LABEL,
} from '@/features/stays/constants/stays.constants';
import type { BookingDraft, RatePlan } from '@/features/stays/types';

export default function RatesScreen() {
  const { id, roomTypeId } = useLocalSearchParams<{ id: string; roomTypeId: string }>();
  const prop = useProperty(String(id));
  const rooms = useRoomTypes(String(id));
  const { query, setDraft } = useStaysStore();
  const [selected, setSelected] = useState<string | null>(null);

  const room = useMemo(() => rooms.data?.find((r) => r.id === roomTypeId) ?? rooms.data?.[0], [rooms.data, roomTypeId]);
  const plans = room?.ratePlans ?? [];
  const plan = plans.find((p) => p.id === selected) ?? null;
  const nights = nightsBetween(query.checkIn, query.checkOut);

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
      guests: query.guests,
      pricePerNightMinor: plan.pricePerNightMinor,
      currency: plan.currency,
      sourceRail: prop.data.sourceRail,
    };
    setDraft(draft);
    router.push('/stays/book/review');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Rate plans" subtitle={room?.name} />
      {rooms.isLoading || prop.isLoading ? (
        <StateView kind="loading" message="Loading rates…" />
      ) : rooms.isError || !room ? (
        <StateView kind="error" title="Couldn't load rates" actionLabel="Retry" onAction={() => rooms.refetch()} />
      ) : (
        <>
          <View style={styles.compareHint}>
            <Info size={14} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.compareText}>Compare refundable, non-refundable, breakfast & mobile rates</Text>
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
                {selected === rp.id ? (
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>{nights} night{nights > 1 ? 's' : ''} · {BOARD_LABEL[rp.board]}</Text>
                    <Text style={styles.totalVal}>{formatNaira(chargeableKobo(rp.pricePerNightMinor, rp.currency) * nights)}</Text>
                  </View>
                ) : null}
              </View>
            ))}
          </ScrollView>

          {plan ? (
            <View style={styles.footer}>
              <View style={{ flex: 1 }}>
                <Text style={styles.footerLabel}>Total ({nights} night{nights > 1 ? 's' : ''})</Text>
                <Text style={styles.footerPrice}>{formatNaira(chargeableKobo(plan.pricePerNightMinor, plan.currency) * nights)}</Text>
              </View>
              <View style={{ width: 160 }}>
                <PrimaryButton label="Reserve" onPress={proceed} />
              </View>
            </View>
          ) : null}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  compareHint: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginHorizontal: Spacing.containerMargin, backgroundColor: Colors.iconBgBlue, borderRadius: Radius.md, padding: Spacing.sm, marginBottom: Spacing.sm },
  compareText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg },
  roomLink: { paddingVertical: Spacing.sm, marginBottom: Spacing.xs },
  roomLinkText: { ...Typography.labelMd, color: Colors.secondary },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderBottomLeftRadius: Radius.lg, borderBottomRightRadius: Radius.lg, marginTop: -Spacing.xs },
  totalLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  totalVal: { ...Typography.titleMd, color: Colors.primary, fontWeight: '700' as const },
  footer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, ...shadow2 },
  footerLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  footerPrice: { ...Typography.titleLg, color: Colors.onSurface },
});
