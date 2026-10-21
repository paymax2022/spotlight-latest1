import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { MapPin, X, LogIn, Clock, Check } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import QrCodeView from '@/components/QrCodeView';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { errKind } from '@/features/mobility/utils/errKind';
import { confirmAsync } from '@/lib/confirm';
import { useBusCancelRequest, useBusV2Booking } from '@/features/mobility/hooks/useBusV2';
import {
  BUS_V2_BOOKING_STATUS_LABEL,
  BUS_V2_TICKET_STATUS_LABEL,
  busTicketTrack,
  busV2CancelPolicyCopy,
  busV2StatusTone,
  isTicketScannable,
  parseBusV2Error,
} from '@/features/mobility/utils/busV2';
import { formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import type { BusV2Ticket } from '@/features/mobility/types/busV2.types';

const dt = (iso: string) =>
  !iso || Number.isNaN(Date.parse(iso))
    ? '—'
    : new Date(iso).toLocaleString('en-NG', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Boarding pass for one booking ref — one QR per issued ticket. The QR payload
 * is the non-guessable ticket token the operator scans at check-in
 * (POST /mobility/bus/provider/checkin {ticket_token, stop_seq}). While the
 * booking is pending_payment the screen polls — the webhook turns payment into
 * issued tickets — and cancellation is a REQUEST with the policy shown first.
 */
export default function BusTicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const booking = useBusV2Booking(id);
  const cancel = useBusCancelRequest();
  const [cancelNote, setCancelNote] = React.useState<{ tone: 'success' | 'warning'; text: string } | null>(null);

  const b = booking.data;

  if (booking.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Your ticket" /><StateView kind="loading" message="Loading ticket…" /></SafeAreaView>
    );
  }
  if (booking.isError || !b) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Your ticket" /><MobilityEdgeState kind={errKind(booking.error)} actionLabel="Retry" onAction={() => booking.refetch()} /></SafeAreaView>
    );
  }

  const pendingPay = b.status === 'pending_payment' || b.status === 'partially_issued';
  const policy = busV2CancelPolicyCopy(b.cancelPolicy, dt);
  const cancellable = b.cancelPolicy.cancellable && b.status !== 'cancelled' && b.status !== 'refunded' && b.status !== 'expired' && b.status !== 'cancel_requested';
  // The transition track keys off the furthest-along ticket.
  const leadTicket = b.tickets[0];

  const onCancel = async () => {
    const ok = await confirmAsync({
      title: 'Request cancellation?',
      message: policy.hint ?? 'The operator will confirm your cancellation and any refund due.',
      confirmLabel: 'Request cancellation',
      cancelLabel: 'Keep ticket',
      destructive: true,
    });
    if (!ok || !id) return;
    cancel.mutate(id, {
      onSuccess: (r) => {
        setCancelNote(
          r.refundStatus === 'refunded'
            ? { tone: 'success', text: `${formatNairaWhole(r.refundedKobo)} has been returned to your wallet.` }
            : { tone: 'warning', text: r.message || 'Cancellation requested — the refund verdict is pending.' },
        );
      },
      onError: (e) => {
        const { message } = parseBusV2Error(e);
        setCancelNote({ tone: 'warning', text: message });
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Boarding pass" onBack={() => router.replace('/mobility/bus/tickets')} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={booking.isRefetching} onRefresh={() => booking.refetch()} tintColor={Colors.primary} />}
      >
        <View style={[styles.pass, shadow1]}>
          <View style={styles.passHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.operator}>{b.operatorName || 'Bus operator'}</Text>
              <Text style={styles.routeLabel}>{b.routeLabel}</Text>
              <Text style={styles.refText}>Ref {b.bookingRef}</Text>
            </View>
            <StatusBadge label={BUS_V2_BOOKING_STATUS_LABEL[b.status]} tone={busV2StatusTone(b.status)} />
          </View>

          {/* Status transitions — the happy path issued → boarded → completed. */}
          {leadTicket && busTicketTrack(leadTicket.status).length > 0 ? (
            <View style={styles.track}>
              {busTicketTrack(leadTicket.status).map((s, i, arr) => (
                <React.Fragment key={s.label}>
                  <View style={styles.trackStep}>
                    <View style={[styles.trackDot, (s.done || s.current) && styles.trackDotDone]}>
                      {s.done ? <Check size={10} color={Colors.onPrimary} strokeWidth={3} /> : null}
                    </View>
                    <Text style={[styles.trackLabel, s.current && styles.trackLabelCurrent]}>{s.label}</Text>
                  </View>
                  {i < arr.length - 1 ? <View style={[styles.trackLine, s.done && styles.trackLineDone]} /> : null}
                </React.Fragment>
              ))}
            </View>
          ) : null}

          <View style={styles.terminals}>
            <View style={styles.terminalCol}>
              <Text style={styles.tLabel}>BOARDING</Text>
              <Text style={styles.tValue}>{b.boardingAt ? dt(b.boardingAt) : '—'}</Text>
            </View>
            <View style={styles.terminalCol}>
              <Text style={styles.tLabel}>DEPARTURE</Text>
              <Text style={styles.tValue}>{dt(b.departureAt)}</Text>
            </View>
          </View>
        </View>

        {pendingPay ? (
          <View style={styles.pendingCard}>
            <Text style={styles.pendingTitle}>Confirming your payment…</Text>
            <Text style={styles.pendingText}>
              The booking is held while Paystack confirms — tickets appear here automatically. Pull to refresh.
            </Text>
          </View>
        ) : null}

        {/* One QR per ticket — payload is the non-guessable ticket token. */}
        {b.tickets.map((t: BusV2Ticket) => (
          <View key={t.ticketToken || `${t.legIndex}-${t.seatLabel}`} style={[styles.pass, shadow1]}>
            <View style={styles.ticketHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.ticketPax}>{t.passengerName}</Text>
                <Text style={styles.ticketMeta}>
                  Seat {t.seatLabel}{b.tickets.length > 1 ? ` · Leg ${t.legIndex + 1}` : ''}
                </Text>
              </View>
              <StatusBadge label={BUS_V2_TICKET_STATUS_LABEL[t.status]} tone={busV2StatusTone(t.status)} />
            </View>

            <View style={styles.tRowWrap}>
              <View style={styles.tRow}><MapPin size={12} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.tTerminal} numberOfLines={1}>{t.fromTerminal}</Text></View>
              <View style={styles.tRow}><LogIn size={12} color={Colors.secondary} strokeWidth={2} /><Text style={styles.tTerminal} numberOfLines={1}>{t.boardingAt ? `Boards ${dt(t.boardingAt)}` : '—'}</Text></View>
              <View style={styles.tRow}><Clock size={12} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.tTerminal} numberOfLines={1}>{t.toTerminal} · {dt(t.departureAt)}</Text></View>
            </View>

            {isTicketScannable(t.status) && t.ticketToken ? (
              <View style={styles.qrWrap}>
                <QrCodeView payload={t.ticketToken} size={170} />
                <Text style={styles.qrHint}>Show this QR to the operator to board.</Text>
              </View>
            ) : (
              <Text style={styles.voided}>
                {t.status === 'refunded' ? 'Refunded — QR voided'
                  : t.status === 'cancelled' || t.status === 'cancel_requested' ? 'Cancelled — QR voided'
                  : t.status === 'boarded' ? 'Checked in — enjoy the trip'
                  : t.status === 'completed' ? 'Trip completed'
                  : t.status === 'expired' ? 'Booking expired — QR voided'
                  : 'QR unavailable'}
              </Text>
            )}
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        {cancelNote ? (
          <Text style={[styles.note, cancelNote.tone === 'success' && styles.noteSuccess]}>{cancelNote.text}</Text>
        ) : null}
        {cancellable && !pendingPay ? (
          <View style={styles.cancelBox}>
            {policy.hint ? <Text style={styles.cancelHint}>{policy.hint}</Text> : null}
            <Pressable
              style={styles.cancelBtn}
              onPress={onCancel}
              disabled={cancel.isPending}
              accessibilityState={{ disabled: cancel.isPending }}
              accessibilityRole="button"
              accessibilityLabel="Request booking cancellation"
            >
              <X size={16} color={Colors.error} strokeWidth={2} />
              <Text style={styles.cancelText}>{cancel.isPending ? 'Requesting…' : policy.label}</Text>
            </Pressable>
          </View>
        ) : !cancellable && policy.hint && !pendingPay ? (
          <Text style={styles.cancelHint}>{policy.hint}</Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.md },
  pass: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.outlineVariant, gap: Spacing.md },
  passHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.sm },
  operator: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  routeLabel: { ...Typography.titleLg, color: Colors.onSurface },
  refText: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },
  track: { flexDirection: 'row', alignItems: 'center' },
  trackStep: { alignItems: 'center', gap: 4 },
  trackDot: { width: 16, height: 16, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  trackDotDone: { backgroundColor: Colors.tertiaryContainer },
  trackLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  trackLabelCurrent: { color: Colors.onSurface, fontWeight: '700' as const },
  trackLine: { flex: 1, height: 2, backgroundColor: Colors.surfaceContainerHigh, marginBottom: 16 },
  trackLineDone: { backgroundColor: Colors.tertiaryContainer },
  terminals: { flexDirection: 'row', gap: Spacing.md },
  terminalCol: { flex: 1, gap: 2 },
  tLabel: { ...Typography.caption, color: Colors.onSurfaceVariant, letterSpacing: 1 },
  tValue: { ...Typography.labelMd, color: Colors.onSurface },
  pendingCard: { backgroundColor: Colors.iconBgGold, borderRadius: Radius.lg, padding: Spacing.md, gap: 4 },
  pendingTitle: { ...Typography.labelLg, color: Colors.onWarning },
  pendingText: { ...Typography.labelSm, color: Colors.onWarning },
  ticketHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.sm },
  ticketPax: { ...Typography.titleMd, color: Colors.onSurface },
  ticketMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  tRowWrap: { gap: 4 },
  tRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tTerminal: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  qrWrap: { alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  qrHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  voided: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', paddingVertical: Spacing.lg },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
  note: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', marginBottom: Spacing.sm },
  noteSuccess: { color: Colors.primary },
  cancelBox: { gap: Spacing.xs },
  cancelHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52 },
  cancelText: { ...Typography.labelMd, color: Colors.error },
});
