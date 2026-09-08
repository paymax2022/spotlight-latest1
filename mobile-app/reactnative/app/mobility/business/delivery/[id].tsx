import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { MapPin, User, FileCheck, AlertTriangle, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import TripPinDisplay from '@/features/mobility/components/TripPinDisplay';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useDelivery, useCancelDelivery } from '@/features/mobility/hooks/useLogistics';
import { DELIVERY_STATUS_LABEL } from '@/features/mobility/constants/modes.constants';
import { formatNaira } from '@/features/mobility/utils/mobilityFormatters';
import type { DeliveryStatus } from '@/features/mobility/types/logistics.types';

const dt = (iso: string) => new Date(iso).toLocaleString('en-NG', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const CANCELLABLE: DeliveryStatus[] = ['created', 'assigned'];

function statusTone(s: DeliveryStatus) {
  if (s === 'delivered') return 'success' as const;
  if (s === 'failed' || s === 'cancelled') return 'danger' as const;
  if (s === 'picked_up') return 'info' as const;
  return 'neutral' as const;
}

export default function DeliveryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const delivery = useDelivery(id, { poll: true });
  const cancel = useCancelDelivery();
  const d = delivery.data;

  if (delivery.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Delivery" /><StateView kind="loading" message="Loading delivery…" /></SafeAreaView>
    );
  }
  if (delivery.isError || !d) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Delivery" /><MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => delivery.refetch()} /></SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Delivery" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={[styles.card, shadow1]}>
          <View style={styles.headRow}>
            <Text style={styles.receiver} numberOfLines={1}>{d.receiverName}</Text>
            <StatusBadge label={DELIVERY_STATUS_LABEL[d.status]} tone={statusTone(d.status)} />
          </View>

          <View style={styles.route}>
            <View style={styles.routeRow}>
              <MapPin size={16} color={Colors.secondary} strokeWidth={2} />
              <Text style={styles.routeText} numberOfLines={1}>{d.pickup.address}</Text>
            </View>
            <View style={styles.routeRow}>
              <MapPin size={16} color={Colors.primary} strokeWidth={2} />
              <Text style={styles.routeText} numberOfLines={1}>{d.dropoff.address}</Text>
            </View>
          </View>

          <View style={styles.dashed} />

          <View style={styles.detailRow}>
            <Detail label="Fare" value={formatNaira(d.fareKobo)} />
            <Detail label="COD" value={d.codKobo > 0 ? formatNaira(d.codKobo) : '—'} />
            <Detail label="Size" value={d.size} />
          </View>
          <Text style={styles.created}>Created {dt(d.createdAt)}{d.deliveredAt ? ` · Delivered ${dt(d.deliveredAt)}` : ''}</Text>
        </View>

        {/* Courier */}
        {d.courierName && (
          <View style={styles.infoCard}>
            <View style={styles.infoIcon}><User size={18} color={Colors.primary} strokeWidth={2} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.infoLabel}>Courier</Text>
              <Text style={styles.infoValue}>{d.courierName}</Text>
            </View>
          </View>
        )}

        {/* Dropoff PIN */}
        {d.dropoffPin && d.status !== 'delivered' && d.status !== 'cancelled' && (
          <TripPinDisplay pin={d.dropoffPin} hint="Share this PIN with the receiver to confirm drop-off." />
        )}

        {/* Proof of delivery */}
        {d.proofUrl && (
          <View style={styles.infoCard}>
            <View style={[styles.infoIcon, styles.infoIconSuccess]}><FileCheck size={18} color={Colors.tertiaryContainer} strokeWidth={2} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.infoLabel}>Proof of delivery</Text>
              <Text style={styles.infoValue} numberOfLines={1}>{d.proofUrl}</Text>
            </View>
          </View>
        )}

        {/* Failure reason */}
        {d.status === 'failed' && d.failureReason && (
          <View style={styles.failCard}>
            <AlertTriangle size={18} color={Colors.error} strokeWidth={2} />
            <Text style={styles.failText}>{d.failureReason}</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {CANCELLABLE.includes(d.status) ? (
          <Pressable style={styles.cancelBtn} onPress={() => id && cancel.mutate(id, { onSuccess: () => goBack('/mobility/business') })} disabled={cancel.isPending}>
            <X size={16} color={Colors.error} strokeWidth={2} />
            <Text style={styles.cancelText}>{cancel.isPending ? 'Cancelling…' : 'Cancel & void delivery'}</Text>
          </Pressable>
        ) : (
          <Text style={styles.noActions}>No further actions available for this delivery.</Text>
        )}
      </View>
    </SafeAreaView>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailCol}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.outlineVariant, gap: Spacing.md },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.sm },
  receiver: { ...Typography.titleLg, color: Colors.onSurface, flex: 1 },
  route: { gap: Spacing.sm },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  routeText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  dashed: { height: 1, borderTopWidth: 1.5, borderColor: Colors.outlineVariant, borderStyle: 'dashed' },
  detailRow: { flexDirection: 'row', gap: Spacing.md },
  detailCol: { flex: 1, gap: 2 },
  detailLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  detailValue: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' as const, textTransform: 'capitalize' },
  created: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  infoCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  infoIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  infoIconSuccess: { backgroundColor: Colors.tertiaryFixed },
  infoLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  infoValue: { ...Typography.labelMd, color: Colors.onSurface },
  failCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.errorContainer, borderRadius: Radius.lg, padding: Spacing.md },
  failText: { ...Typography.labelMd, color: Colors.error, flex: 1, lineHeight: 18 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52 },
  cancelText: { ...Typography.labelMd, color: Colors.error },
  noActions: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', paddingVertical: Spacing.md },
});
