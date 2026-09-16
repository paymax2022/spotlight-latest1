import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TrendingUp, TrendingDown, BadgePercent } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useDriverEarnings } from '@/features/mobility/hooks/useMobility';
import { formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import { COMMISSION_TIER_LABEL } from '@/features/mobility/constants/mobility.constants';
import type { DriverTripSummary } from '@/features/mobility/types/mobility.types';

export default function DriverEarningsScreen() {
  const earnings = useDriverEarnings();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Earnings" />

      {earnings.isLoading ? (
        <StateView kind="loading" message="Loading earnings…" />
      ) : earnings.isError ? (
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => earnings.refetch()} />
      ) : earnings.data ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={earnings.isRefetching} onRefresh={() => earnings.refetch()} tintColor={Colors.primary} />}
        >
          {/* Net hero */}
          <View style={[styles.hero, shadow1]}>
            <Text style={styles.heroLabel}>Net earnings (all time)</Text>
            <Text style={styles.heroValue}>{formatNairaWhole(earnings.data.netKobo)}</Text>
            <View style={styles.heroSplit}>
              <View style={styles.splitItem}>
                <TrendingUp size={14} color={Colors.tertiaryFixed} strokeWidth={2.2} />
                <Text style={styles.splitText}>Gross {formatNairaWhole(earnings.data.grossKobo)}</Text>
              </View>
              <View style={styles.splitItem}>
                <TrendingDown size={14} color={Colors.inversePrimary} strokeWidth={2.2} />
                <Text style={styles.splitText}>Platform fee {formatNairaWhole(earnings.data.platformFeeKobo)}</Text>
              </View>
            </View>
          </View>

          {/* Stats */}
          <View style={styles.statsRow}>
            <View style={[styles.statCard, shadow1]}>
              <Text style={styles.statValue}>{earnings.data.tripsCompleted}</Text>
              <Text style={styles.statLabel}>Completed trips</Text>
            </View>
            <View style={[styles.statCard, shadow1]}>
              <Text style={styles.statValue}>{earnings.data.cancelRatePct.toFixed(1)}%</Text>
              <Text style={styles.statLabel}>Cancel rate</Text>
            </View>
          </View>

          {/* Commission tier */}
          <View style={[styles.tierCard, shadow1]}>
            <View style={styles.tierIcon}><BadgePercent size={20} color={Colors.primary} strokeWidth={2.2} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.tierLabel}>Commission tier</Text>
              <Text style={styles.tierValue}>{COMMISSION_TIER_LABEL[earnings.data.commission.tier]}</Text>
            </View>
            <Text style={styles.tierSplit}>{earnings.data.commission.driverPct}/{earnings.data.commission.platformPct}</Text>
          </View>

          {/* Recent trips */}
          <Text style={styles.sectionLabel}>Recent trips</Text>
          <View style={styles.tripList}>
            {earnings.data.recentTrips.length === 0 ? (
              <MobilityEdgeState kind="empty" compact title="No trips yet" message="Completed trips and their payouts show here." />
            ) : (
              earnings.data.recentTrips.map((trip) => <TripRow key={trip.tripId} trip={trip} />)
            )}
          </View>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

function TripRow({ trip }: { trip: DriverTripSummary }) {
  const time = new Date(trip.completedAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return (
    <View style={styles.tripRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.tripRoute} numberOfLines={1}>{trip.pickupLabel} → {trip.destLabel}</Text>
        <Text style={styles.tripTime}>{time}</Text>
      </View>
      <View style={styles.tripAmounts}>
        <Text style={styles.tripNet}>{formatNairaWhole(trip.netKobo)}</Text>
        <Text style={styles.tripGross}>fare {formatNairaWhole(trip.fareKobo)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  hero: { backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.cardPadding },
  heroLabel: { ...Typography.labelSm, color: Colors.inversePrimary },
  heroValue: { ...Typography.displayLg, fontSize: 40, letterSpacing: -0.8, lineHeight: 46, color: Colors.onPrimary, fontWeight: '800' as const, marginTop: 4 },
  heroSplit: { flexDirection: 'row', gap: Spacing.lg, marginTop: Spacing.md },
  splitItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  splitText: { ...Typography.labelSm, color: Colors.inverseOnSurface },
  statsRow: { flexDirection: 'row', gap: Spacing.md },
  statCard: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.outlineVariant },
  statValue: { ...Typography.headlineMd, color: Colors.onSurface, fontWeight: '800' as const },
  statLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  tierCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  tierIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  tierLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  tierValue: { ...Typography.labelLg, color: Colors.onSurface },
  tierSplit: { ...Typography.titleMd, color: Colors.primary, fontWeight: '800' as const },
  sectionLabel: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.sm },
  tripList: { gap: Spacing.sm },
  tripRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  tripRoute: { ...Typography.labelLg, color: Colors.onSurface },
  tripTime: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  tripAmounts: { alignItems: 'flex-end' },
  tripNet: { ...Typography.titleMd, color: Colors.tertiaryContainer, fontWeight: '700' as const },
  tripGross: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
