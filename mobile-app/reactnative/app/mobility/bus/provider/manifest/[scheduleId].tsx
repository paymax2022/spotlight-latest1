import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Armchair, Phone } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { confirmAsync } from '@/lib/confirm';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { errKind } from '@/features/mobility/utils/errKind';
import { useProviderManifest, useCancelSchedule } from '@/features/mobility/hooks/useBusMarketplace';
import { scheduleCancelCopy } from '@/features/mobility/utils/busBoarding';
import { formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import type { BusManifestEntry } from '@/features/mobility/types/busProvider.types';


export default function BusProviderManifestScreen() {
  const { scheduleId } = useLocalSearchParams<{ scheduleId: string }>();
  const manifest = useProviderManifest(scheduleId);

  const paidCount = (manifest.data ?? []).filter((b) => b.paymentStatus === 'settled').length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Departure manifest" subtitle={manifest.data ? `${manifest.data.length} booked · ${paidCount} paid` : undefined} />
      <View style={styles.actions}>
        <PrimaryButton
          label="Scan tickets to board"
          onPress={() => router.push({ pathname: '/mobility/bus/provider/scan', params: { scheduleId } })}
        />
        <CancelDeparture scheduleId={scheduleId} />
      </View>
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

// Cancelling refunds every active ticket server-side (resumable). The summary
// shown is the server's count — it never claims a refund that has not posted.
function CancelDeparture({ scheduleId }: { scheduleId?: string }) {
  const cancel = useCancelSchedule();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const summary = cancel.data ? scheduleCancelCopy(cancel.data) : null;

  const submit = async () => {
    if (!scheduleId) return;
    const ok = await confirmAsync({
      title: 'Cancel this departure?',
      message: 'Every booked passenger will be refunded and the departure removed from search. This cannot be undone.',
      confirmLabel: 'Cancel departure',
      cancelLabel: 'Keep departure',
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await cancel.mutateAsync({ scheduleId, reason: reason.trim() });
      setOpen(false);
    } catch (e) {
      const err = e as { response?: { data?: { error?: unknown } }; message?: string };
      const msg = err?.response?.data?.error;
      setError(typeof msg === 'string' ? msg : err?.message ?? 'Could not cancel this departure.');
    }
  };

  if (summary) {
    // A partial result (refunds still processing) can be resumed by re-calling.
    return (
      <View style={[styles.notice, summary.tone === 'success' ? styles.noticeOk : styles.noticeWarn]}>
        <Text style={styles.noticeText}>{summary.text}</Text>
        {!cancel.data!.complete ? (
          <PrimaryButton label="Retry pending refunds" variant="secondary" loading={cancel.isPending}
            onPress={() => scheduleId && cancel.mutate({ scheduleId, reason: reason.trim() })} />
        ) : null}
      </View>
    );
  }
  if (!open) return <PrimaryButton label="Cancel departure" variant="ghost" onPress={() => setOpen(true)} />;
  return (
    <View style={styles.cancelBox}>
      <TextInputField label="Reason (shared with passengers)" placeholder="e.g. Bus breakdown" value={reason} onChangeText={setReason} />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <PrimaryButton label="Cancel departure and refund" variant="danger" loading={cancel.isPending} disabled={!reason.trim()} onPress={submit} />
      <PrimaryButton label="Keep departure" variant="ghost" onPress={() => { setOpen(false); setError(null); }} />
    </View>
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
  actions: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, gap: Spacing.sm },
  cancelBox: { gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  errorText: { ...Typography.bodySm, color: Colors.error },
  notice: { borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  noticeOk: { backgroundColor: Colors.iconBgTeal },
  noticeWarn: { backgroundColor: Colors.iconBgGold },
  noticeText: { ...Typography.bodyMd, color: Colors.onSurface },
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
