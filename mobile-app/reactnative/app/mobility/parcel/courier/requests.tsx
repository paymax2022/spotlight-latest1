import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Package, Wallet } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TripRouteCard from '@/features/mobility/components/TripRouteCard';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useCourierRequests, useCourierActions } from '@/features/mobility/hooks/useModes';
import { formatNairaWhole, formatDistance } from '@/features/mobility/utils/mobilityFormatters';
import { PARCEL_CATEGORIES, PARCEL_SPEEDS } from '@/features/mobility/constants/modes.constants';
import type { CourierParcelRequest } from '@/features/mobility/types/modes.types';

const catLabel = (v: string) => PARCEL_CATEGORIES.find((c) => c.value === v)?.label ?? v;
const speedLabel = (v: string) => PARCEL_SPEEDS.find((s) => s.value === v)?.label ?? v;

export default function CourierRequestsScreen() {
  const requests = useCourierRequests({ poll: true });
  const { accept } = useCourierActions();

  const onAccept = (id: string) => {
    accept.mutate(id, { onSuccess: (p) => router.push(`/mobility/parcel/courier/${p.id}`) });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Delivery requests"
        rightSlot={
          <Pressable onPress={() => router.push('/mobility/parcel/courier/earnings')} hitSlop={8} accessibilityLabel="Earnings">
            <Wallet size={20} color={Colors.primary} strokeWidth={2} />
          </Pressable>
        }
      />
      {requests.isLoading ? (
        <StateView kind="loading" message="Looking for jobs near you…" />
      ) : requests.isError ? (
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => requests.refetch()} />
      ) : (requests.data?.length ?? 0) === 0 ? (
        <MobilityEdgeState kind="empty" title="No requests yet" message="New delivery requests near you will appear here." actionLabel="Refresh" onAction={() => requests.refetch()} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={requests.isRefetching} onRefresh={() => requests.refetch()} tintColor={Colors.primary} />}
        >
          {requests.data!.map((r: CourierParcelRequest) => (
            <View key={r.parcelId} style={[styles.card, shadow1]}>
              <View style={styles.cardHead}>
                <View style={styles.iconBox}><Package size={18} color={Colors.primary} strokeWidth={2.2} /></View>
                <Text style={styles.cardMeta}>{catLabel(r.category)} · {speedLabel(r.speed)} · {formatDistance(r.distanceM)}</Text>
              </View>
              <TripRouteCard pickup={r.pickup} dest={r.dropoff} />
              <View style={styles.earnRow}>
                <View>
                  <Text style={styles.earnLabel}>You earn</Text>
                  <Text style={styles.earnValue}>{formatNairaWhole(r.estCourierNetKobo)}</Text>
                </View>
                <Text style={styles.fareNote}>Customer pays {formatNairaWhole(r.fareKobo)}</Text>
              </View>
              <PrimaryButton label="Accept delivery" onPress={() => onAccept(r.parcelId)} loading={accept.isPending} />
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant, gap: Spacing.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  iconBox: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  cardMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  earnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  earnLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  earnValue: { ...Typography.titleMd, color: Colors.tertiaryContainer, fontWeight: '800' as const },
  fareNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
