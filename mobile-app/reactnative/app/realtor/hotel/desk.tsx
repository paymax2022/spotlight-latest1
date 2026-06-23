import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LayoutGrid, RefreshCw, LogIn, LogOut, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import StatusBadge from '@/features/realtor/components/StatusBadge';
import { useDeskSummary, useArrivals } from '@/features/realtor/hooks/useRealtorHotel';
import { formatNaira } from '@/features/realtor/utils/realtorFormatters';

export default function HotelDeskScreen() {
  const summary = useDeskSummary();
  const arrivals = useArrivals();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Front desk"
        subtitle="Today at a glance"
        rightSlot={<Pressable onPress={() => router.push('/realtor/hotel/rooms')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Room board"><LayoutGrid size={22} color={Colors.onSurface} strokeWidth={2} /></Pressable>}
      />
      {summary.isLoading ? (
        <StateView kind="loading" message="Loading the desk…" />
      ) : !summary.data ? null : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View style={styles.metrics}>
            <Metric value={String(summary.data.arrivalsToday)} label="Arrivals" tone={Colors.secondary} />
            <Metric value={String(summary.data.departuresToday)} label="Departures" tone={Colors.primary} />
            <Metric value={`${summary.data.occupancyPct}%`} label="Occupancy" tone={Colors.tertiaryContainer} />
            <Metric value={String(summary.data.available)} label="Available" tone={Colors.onSurface} />
            <Metric value={String(summary.data.dirtyRooms)} label="To clean" tone={Colors.onWarning} />
            <Metric value={formatNaira(summary.data.revenueTodayKobo)} label="Revenue" tone={Colors.tertiaryContainer} />
          </View>

          <View style={styles.actionRow}>
            <Pressable style={styles.action} onPress={() => router.push('/realtor/hotel/rooms')}>
              <LogIn size={18} color={Colors.secondary} strokeWidth={2} /><Text style={styles.actionText}>Check-in</Text>
            </Pressable>
            <Pressable style={styles.action} onPress={() => router.push('/realtor/hotel/rooms')}>
              <LogOut size={18} color={Colors.primary} strokeWidth={2} /><Text style={styles.actionText}>Check-out</Text>
            </Pressable>
            <Pressable style={styles.action} onPress={() => router.push('/realtor/channel-sync')}>
              <RefreshCw size={18} color={Colors.teal} strokeWidth={2} /><Text style={styles.actionText}>Channels</Text>
            </Pressable>
          </View>

          <SectionHeader title="Today's arrivals" actionLabel="Rooms" onAction={() => router.push('/realtor/hotel/rooms')} />
          {arrivals.isLoading ? <StateView kind="loading" compact /> : (
            <View style={styles.arrivals}>
              {(arrivals.data ?? []).map((a) => (
                <View key={a.reservationId} style={styles.arrivalCard}>
                  <View style={styles.arrivalBody}>
                    <Text style={styles.arrivalName}>{a.guestName}</Text>
                    <Text style={styles.arrivalMeta}>{a.roomTypeName} · {a.nights} night{a.nights > 1 ? 's' : ''}</Text>
                  </View>
                  <StatusBadge label="Confirmed" tone="success" />
                  <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Metric({ value, label, tone }: { value: string; label: string; tone: string }) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, { color: tone }]} numberOfLines={1}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.lg },
  metric: { width: '31%', flexGrow: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, ...shadow1 },
  metricValue: { ...Typography.titleLg, color: Colors.onSurface },
  metricLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.lg },
  action: { flex: 1, alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, paddingVertical: Spacing.md },
  actionText: { ...Typography.labelSm, color: Colors.onSurface },
  arrivals: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm },
  arrivalCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  arrivalBody: { flex: 1 },
  arrivalName: { ...Typography.labelLg, color: Colors.onSurface },
  arrivalMeta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
