import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { MapPin, X, Star } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import QrCodeView from '@/components/QrCodeView';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useBusTicket, useCancelTicket, useRateBusTrip } from '@/features/mobility/hooks/useModes';
import { BUS_PHASE_LABEL } from '@/features/mobility/constants/modes.constants';
import { formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';

const dt = (iso: string) => new Date(iso).toLocaleString('en-NG', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function BusTicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ticket = useBusTicket(id);
  const cancel = useCancelTicket();
  const rate = useRateBusTrip();
  const [stars, setStars] = React.useState(0);
  const t = ticket.data;

  if (ticket.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Your ticket" /><StateView kind="loading" message="Loading ticket…" /></SafeAreaView>
    );
  }
  if (ticket.isError || !t) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Your ticket" /><MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => ticket.refetch()} /></SafeAreaView>
    );
  }

  const active = t.phase !== 'cancelled' && t.phase !== 'refunded';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Boarding pass" onBack={() => router.replace('/mobility/bus/tickets')} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={[styles.pass, shadow1]}>
          <View style={styles.passHead}>
            <View>
              <Text style={styles.operator}>{t.operatorName}</Text>
              <Text style={styles.routeLabel}>{t.routeLabel}</Text>
            </View>
            <StatusBadge label={BUS_PHASE_LABEL[t.phase]} tone={t.phase === 'completed' ? 'success' : t.phase === 'cancelled' || t.phase === 'refunded' ? 'danger' : 'info'} />
          </View>

          <View style={styles.terminals}>
            <View style={styles.terminalCol}>
              <Text style={styles.tLabel}>DEPART</Text>
              <Text style={styles.tValue}>{dt(t.departAt)}</Text>
              <View style={styles.tRow}><MapPin size={12} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.tTerminal} numberOfLines={1}>{t.originTerminal}</Text></View>
            </View>
            <View style={styles.terminalCol}>
              <Text style={styles.tLabel}>ARRIVE</Text>
              <Text style={styles.tValue}>{dt(t.arriveAt)}</Text>
              <View style={styles.tRow}><MapPin size={12} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.tTerminal} numberOfLines={1}>{t.destTerminal}</Text></View>
            </View>
          </View>

          <View style={styles.dashed} />

          <View style={styles.detailRow}>
            <Detail label="Passenger" value={t.passengerName} />
            <Detail label="Seat" value={t.seatNumber} />
            <Detail label="Fare" value={formatNairaWhole(t.fareKobo)} />
          </View>

          {/* QR */}
          {active && t.qrCode ? (
            <View style={styles.qrWrap}>
              <QrCodeView payload={t.qrCode} size={180} />
              <Text style={styles.qrHint}>Show this QR to the operator to board.</Text>
            </View>
          ) : (
            <Text style={styles.voided}>{t.phase === 'refunded' ? 'Refunded — QR voided' : t.phase === 'completed' ? 'Trip completed' : 'QR unavailable'}</Text>
          )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {(t.phase === 'completed' || t.phase === 'boarded') && !rate.isSuccess ? (
          <View style={styles.rateBox}>
            <Text style={styles.rateTitle}>Rate this operator</Text>
            <View style={styles.starRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable key={n} onPress={() => setStars(n)} hitSlop={6}>
                  <Star size={30} strokeWidth={2} color={Colors.gold} fill={n <= stars ? Colors.gold : 'transparent'} />
                </Pressable>
              ))}
            </View>
            <PrimaryButton
              label={rate.isPending ? 'Submitting…' : 'Submit rating'}
              onPress={() => id && stars > 0 && rate.mutate({ id, stars })}
              loading={rate.isPending}
              disabled={stars === 0}
            />
          </View>
        ) : active && t.phase !== 'boarded' && t.phase !== 'completed' ? (
          <Pressable style={styles.cancelBtn} onPress={() => id && cancel.mutate(id)} disabled={cancel.isPending}>
            <X size={16} color={Colors.error} strokeWidth={2} />
            <Text style={styles.cancelText}>{cancel.isPending ? 'Cancelling…' : 'Cancel & request refund'}</Text>
          </Pressable>
        ) : (
          <PrimaryButton label={rate.isSuccess ? 'Thanks for rating!' : 'My tickets'} onPress={() => router.replace('/mobility/bus/tickets')} />
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
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg },
  pass: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.outlineVariant, gap: Spacing.md },
  rateBox: { gap: Spacing.sm },
  rateTitle: { ...Typography.labelLg, color: Colors.onSurface, textAlign: 'center' },
  starRow: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs },
  passHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  operator: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  routeLabel: { ...Typography.titleLg, color: Colors.onSurface },
  terminals: { flexDirection: 'row', gap: Spacing.md },
  terminalCol: { flex: 1, gap: 2 },
  tLabel: { ...Typography.caption, color: Colors.onSurfaceVariant, letterSpacing: 1 },
  tValue: { ...Typography.labelLg, color: Colors.onSurface },
  tRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  tTerminal: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  dashed: { height: 1, borderTopWidth: 1.5, borderColor: Colors.outlineVariant, borderStyle: 'dashed' },
  detailRow: { flexDirection: 'row', gap: Spacing.md },
  detailCol: { flex: 1, gap: 2 },
  detailLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  detailValue: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' as const },
  qrWrap: { alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  qrHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  voided: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', paddingVertical: Spacing.lg },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52 },
  cancelText: { ...Typography.labelMd, color: Colors.error },
});
