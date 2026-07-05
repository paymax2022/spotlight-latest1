import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { AlertTriangle, X, Pencil, ArrowRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import TripRouteCard from '@/features/mobility/components/TripRouteCard';
import FareBreakdownCard from '@/features/mobility/components/FareBreakdownCard';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import ScheduledStatusChip from '@/features/mobility/components/ScheduledStatusChip';
import { useScheduledDetail, useRescheduleScheduled, useCancelScheduled } from '@/features/mobility/hooks/useScheduled';
import { SCHEDULED_MODE_META } from '@/features/mobility/constants/modes.constants';

const errKind = (e: unknown): 'offline' | 'genericError' =>
  (e as { response?: unknown })?.response ? 'genericError' : 'offline';

function modeLabel(mode: string): string {
  return SCHEDULED_MODE_META.find((m) => m.value === mode)?.label ?? mode;
}

function useCountdown(targetIso?: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!targetIso) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [targetIso]);
  if (!targetIso) return null;
  const diffMs = new Date(targetIso).getTime() - now;
  if (diffMs <= 0) return 'Due now';
  const totalMin = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  const secs = Math.floor((diffMs % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

/** Maps materializedKind → the live-trip route once the booking has dispatched. */
function liveTripHref(kind: string | null, ref: string | null): string | null {
  if (!kind || !ref) return null;
  if (kind === 'trip') return `/mobility/trip/${ref}`;
  if (kind === 'parcel') return `/mobility/parcel/${ref}`;
  if (kind === 'bus_ticket') return `/mobility/bus/ticket/${ref}`;
  return null;
}

export default function ScheduledDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useScheduledDetail(id, { poll: true });
  const b = detail.data;

  const [editing, setEditing] = useState(false);
  const [draftPickupAt, setDraftPickupAt] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const reschedule = useRescheduleScheduled(id);
  const cancel = useCancelScheduled(id);
  const countdown = useCountdown(b?.status === 'scheduled' || b?.status === 'dispatch_pending' ? b?.scheduledPickupAt : undefined);

  if (detail.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Scheduled trip" showBack={false} />
        <StateView kind="loading" message="Loading your scheduled trip…" />
      </SafeAreaView>
    );
  }
  if (detail.isError || !b) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Scheduled trip" />
        <MobilityEdgeState kind={errKind(detail.error)} actionLabel="Retry" onAction={() => detail.refetch()} />
      </SafeAreaView>
    );
  }

  const canEdit = b.status === 'scheduled';
  const canCancel = b.status === 'scheduled' || b.status === 'dispatch_pending';
  const liveHref = liveTripHref(b.materializedKind, b.materializedRef);

  const onStartEdit = () => {
    setActionError(null);
    setDraftPickupAt(b.scheduledPickupAt);
    setEditing(true);
  };

  const onSaveReschedule = () => {
    setActionError(null);
    reschedule.mutate(
      { scheduledPickupAt: draftPickupAt },
      { onSuccess: () => setEditing(false), onError: (e) => setActionError((e as Error).message) },
    );
  };

  const onCancel = () => {
    setActionError(null);
    cancel.mutate(undefined, {
      onSuccess: () => setCancelling(false),
      onError: (e) => setActionError((e as Error).message),
    });
  };

  const onRebook = () => {
    router.replace({
      pathname: '/mobility/scheduled/new',
      params: {
        pickupAddress: b.pickup?.label ?? '',
        pickupLat: String(b.pickup?.lat ?? ''),
        pickupLng: String(b.pickup?.lng ?? ''),
        destAddress: b.dropoff?.label ?? '',
        lat: String(b.dropoff?.lat ?? ''),
        lng: String(b.dropoff?.lng ?? ''),
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={modeLabel(b.mode)} subtitle={new Date(b.scheduledPickupAt).toLocaleString('en-NG', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.statusRow}>
          <ScheduledStatusChip status={b.status} />
          {countdown && <Text style={styles.countdown}>{countdown} to pickup</Text>}
        </View>

        {b.status === 'failed_no_driver' && (
          <MobilityEdgeState
            kind="noDriver"
            compact
            title="No driver was found for this trip"
            message="We could not match a driver/courier within the fallback window. You can rebook for a new time."
            actionLabel="Rebook"
            onAction={onRebook}
          />
        )}

        {liveHref && (
          <Pressable style={[styles.liveCard, shadow1]} onPress={() => router.push(liveHref as never)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.liveTitle}>Your trip has been dispatched</Text>
              <Text style={styles.liveSub}>Track it live now</Text>
            </View>
            <ArrowRight size={20} color={Colors.onPrimary} strokeWidth={2.4} />
          </Pressable>
        )}

        {b.pickup && b.dropoff && (
          <TripRouteCard
            pickup={{ address: b.pickup.label, lat: b.pickup.lat, lng: b.pickup.lng }}
            dest={{ address: b.dropoff.label, lat: b.dropoff.lat, lng: b.dropoff.lng }}
          />
        )}

        {editing ? (
          <View style={styles.editCard}>
            <Text style={styles.editTitle}>Reschedule</Text>
            <TextInputField label="New pickup date & time (ISO)" value={draftPickupAt} onChangeText={setDraftPickupAt} placeholder="YYYY-MM-DDTHH:mm:00Z" />
            {actionError && <Text style={styles.errText}>{actionError}</Text>}
            <View style={styles.editActions}>
              <PrimaryButton label="Cancel" variant="secondary" onPress={() => setEditing(false)} style={styles.editBtn} />
              <PrimaryButton label="Save" onPress={onSaveReschedule} loading={reschedule.isPending} style={styles.editBtn} />
            </View>
          </View>
        ) : null}

        {b.estimatedFareKobo != null && (
          <FareBreakdownCard
            title="Estimated fare"
            fareKobo={b.estimatedFareKobo}
            rows={[{ label: 'Payment method', valueText: b.paymentMethod }]}
            showTrustNote
          />
        )}

        {b.lastDispatchError && (
          <View style={styles.errRow}><AlertTriangle size={16} color={Colors.error} strokeWidth={2} /><Text style={styles.errText}>{b.lastDispatchError}</Text></View>
        )}

        {cancelling && (
          <View style={styles.editCard}>
            <Text style={styles.editTitle}>Cancel this trip?</Text>
            <Text style={styles.hint}>If a fare was already escrowed, it will be refunded to your wallet.</Text>
            {actionError && <Text style={styles.errText}>{actionError}</Text>}
            <View style={styles.editActions}>
              <PrimaryButton label="Keep it" variant="secondary" onPress={() => setCancelling(false)} style={styles.editBtn} />
              <PrimaryButton label="Cancel trip" variant="danger" onPress={onCancel} loading={cancel.isPending} style={styles.editBtn} />
            </View>
          </View>
        )}

        {!editing && actionError && !cancelling && (
          <View style={styles.errRow}><AlertTriangle size={16} color={Colors.error} strokeWidth={2} /><Text style={styles.errText}>{actionError}</Text></View>
        )}
      </ScrollView>

      {(canEdit || canCancel) && !editing && !cancelling && (
        <View style={styles.footer}>
          <View style={styles.footerRow}>
            {canEdit && (
              <Pressable style={styles.footerBtn} onPress={onStartEdit} accessibilityLabel="Reschedule">
                <Pencil size={16} color={Colors.primary} strokeWidth={2.2} />
                <Text style={styles.footerBtnLabel}>Reschedule</Text>
              </Pressable>
            )}
            {canCancel && (
              <Pressable style={[styles.footerBtn, styles.footerBtnDanger]} onPress={() => setCancelling(true)} accessibilityLabel="Cancel trip">
                <X size={16} color={Colors.error} strokeWidth={2.2} />
                <Text style={[styles.footerBtnLabel, styles.footerBtnLabelDanger]}>Cancel</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  countdown: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  liveCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: Radius.lg, padding: Spacing.md },
  liveTitle: { ...Typography.labelLg, color: Colors.onPrimary },
  liveSub: { ...Typography.labelSm, color: Colors.inversePrimary },
  editCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant, gap: Spacing.sm },
  editTitle: { ...Typography.labelLg, color: Colors.onSurface },
  editActions: { flexDirection: 'row', gap: Spacing.sm },
  editBtn: { flex: 1 },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  errRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  errText: { ...Typography.labelSm, color: Colors.error, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
  footerRow: { flexDirection: 'row', gap: Spacing.sm },
  footerBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 48, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  footerBtnDanger: { borderColor: Colors.error },
  footerBtnLabel: { ...Typography.labelMd, color: Colors.primary },
  footerBtnLabelDanger: { color: Colors.error },
});
