import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Armchair, Phone } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useProviderManifest } from '@/features/mobility/hooks/useBusMarketplace';
import { formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import type { BusManifestEntry } from '@/features/mobility/types/busProvider.types';

const errKind = (e: unknown): 'offline' | 'genericError' =>
  (e as { response?: unknown })?.response ? 'genericError' : 'offline';

export default function BusProviderManifestScreen() {
  const { scheduleId } = useLocalSearchParams<{ scheduleId: string }>();
  const manifest = useProviderManifest(scheduleId);

  const paidCount = (manifest.data ?? []).filter((b) => b.paymentStatus === 'settled').length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Departure manifest" subtitle={manifest.data ? `${manifest.data.length} booked · ${paidCount} paid` : undefined} />
      {manifest.isLoading ? (
        <StateView kind="loading" message="Loading manifest…" />
      ) : manifest.isError ? (
        <MobilityEdgeState kind={errKind(manifest.error)} actionLabel="Retry" onAction={() => manifest.refetch()} />
      ) : (manifest.data?.length ?? 0) === 0 ? (
        <MobilityEdgeState kind="empty" title="No bookings yet" message="Passengers who book this departure will appear here." />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={manifest.isRefetching} onRefresh={() => manifest.refetch()} tintColor={Colors.primary} />}
        >
          {manifest.data!.map((b) => <ManifestRow key={b.id} entry={b} />)}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ManifestRow({ entry }: { entry: BusManifestEntry }) {
  const tone = entry.paymentStatus === 'settled' ? 'success' : entry.paymentStatus === 'refunded' ? 'danger' : 'warning';
  const label = entry.paymentStatus === 'settled' ? 'Paid' : entry.paymentStatus === 'refunded' ? 'Refunded' : 'Unpaid';
  return (
    <View style={styles.row}>
      <View style={styles.seatBox}>
        <Armchair size={16} color={Colors.primary} strokeWidth={2} />
        <Text style={styles.seatNum}>{entry.seatNumber}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{entry.passengerName}</Text>
        <View style={styles.phoneRow}>
          <Phone size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.phone}>{entry.passengerPhone}</Text>
        </View>
      </View>
      <View style={styles.right}>
        <Text style={styles.fare}>{formatNairaWhole(entry.fareKobo)}</Text>
        <StatusBadge label={label} tone={tone} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xl, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  seatBox: { width: 52, height: 52, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  seatNum: { ...Typography.caption, color: Colors.primary, fontWeight: '700' as const },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  phone: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  right: { alignItems: 'flex-end', gap: 4 },
  fare: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' as const },
});
