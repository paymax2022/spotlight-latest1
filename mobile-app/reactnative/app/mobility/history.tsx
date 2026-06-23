import React from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MapPin, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useHistory } from '@/features/mobility/hooks/useMobility';
import { formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import { SERVICE_TYPE_LABEL } from '@/features/mobility/constants/mobility.constants';
import type { Trip } from '@/features/mobility/types/mobility.types';

export default function HistoryScreen() {
  const history = useHistory();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Trip history" />

      {history.isLoading ? (
        <StateView kind="loading" message="Loading your trips…" />
      ) : history.isError ? (
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => history.refetch()} />
      ) : (history.data?.length ?? 0) === 0 ? (
        <MobilityEdgeState
          kind="empty"
          title="No trips yet"
          message="Your completed and cancelled trips will appear here."
          actionLabel="Book a ride"
          onAction={() => router.replace('/mobility/estimate')}
        />
      ) : (
        <FlatList
          data={history.data}
          keyExtractor={(t) => t.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={history.isRefetching} onRefresh={() => history.refetch()} tintColor={Colors.primary} />}
          renderItem={({ item }) => <HistoryRow trip={item} />}
        />
      )}
    </SafeAreaView>
  );
}

function HistoryRow({ trip }: { trip: Trip }) {
  const date = new Date(trip.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
  const canRate = trip.phase === 'completed' && !trip.rated;
  return (
    <Pressable
      style={styles.row}
      onPress={() => (canRate ? router.push(`/mobility/trip/${trip.id}/rate`) : undefined)}
      accessibilityLabel={`Trip on ${date}`}
    >
      <View style={styles.iconWrap}>
        <MapPin size={18} color={Colors.secondary} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text style={styles.dest} numberOfLines={1}>{trip.dest.label ?? trip.dest.address}</Text>
          <StatusBadge phase={trip.phase} />
        </View>
        <Text style={styles.meta}>
          {date} · {SERVICE_TYPE_LABEL[trip.serviceType]}
          {trip.phase !== 'cancelled' ? ` · ${formatNairaWhole(trip.fareKobo)}` : ' · refunded'}
        </Text>
        {canRate && <Text style={styles.rateHint}>Tap to rate your driver</Text>}
      </View>
      {canRate && <ChevronRight size={18} color={Colors.onSurfaceVariant} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  iconWrap: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  dest: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  rateHint: { ...Typography.labelSm, color: Colors.secondary, marginTop: 2 },
});
