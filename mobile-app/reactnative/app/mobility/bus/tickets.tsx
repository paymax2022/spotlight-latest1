import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ticket, ChevronRight, Users } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { errKind } from '@/features/mobility/utils/errKind';
import { useBusV2Bookings } from '@/features/mobility/hooks/useBusV2';
import { BUS_V2_BOOKING_STATUS_LABEL, busV2StatusTone } from '@/features/mobility/utils/busV2';
import { formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';

const dt = (iso: string) =>
  !iso || Number.isNaN(Date.parse(iso))
    ? '—'
    : new Date(iso).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** My bus bookings (v2) — one row per booking ref, covering all legs + pax. */
export default function BusTicketsScreen() {
  const bookings = useBusV2Bookings();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My tickets" />
      {bookings.isLoading ? (
        <StateView kind="loading" message="Loading tickets…" />
      ) : bookings.isError ? (
        <MobilityEdgeState kind={errKind(bookings.error)} actionLabel="Retry" onAction={() => bookings.refetch()} />
      ) : (bookings.data?.length ?? 0) === 0 ? (
        <MobilityEdgeState kind="empty" title="No tickets yet" message="Your bus bookings will appear here." actionLabel="Book a bus" onAction={() => router.replace('/mobility/bus')} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={bookings.isRefetching} onRefresh={() => bookings.refetch()} tintColor={Colors.primary} />}
        >
          {bookings.data!.map((b) => (
            <Pressable
              key={b.bookingRef}
              style={styles.row}
              onPress={() => router.push(`/mobility/bus/ticket/${b.bookingRef}`)}
              accessibilityRole="button"
              accessibilityLabel={`Booking ${b.bookingRef}, ${b.routeLabel}`}
            >
              <View style={styles.rowIcon}><Ticket size={20} color={Colors.primary} strokeWidth={2} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.routeLabel} numberOfLines={1}>{b.routeLabel}</Text>
                <Text style={styles.meta}>{dt(b.departureAt)} · {formatNairaWhole(b.totalKobo)}</Text>
                <View style={styles.metaRow}>
                  <Users size={11} color={Colors.onSurfaceVariant} strokeWidth={2} />
                  <Text style={styles.meta}>{b.passengerCount} · Seats {b.seatLabels.join(', ') || '—'}</Text>
                </View>
                <View style={styles.badgeRow}>
                  <StatusBadge label={BUS_V2_BOOKING_STATUS_LABEL[b.status]} tone={busV2StatusTone(b.status)} />
                </View>
              </View>
              <ChevronRight size={18} color={Colors.onSurfaceVariant} />
            </Pressable>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  rowIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  routeLabel: { ...Typography.labelLg, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  badgeRow: { marginTop: Spacing.xs },
});
