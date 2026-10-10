import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Car, UserCheck, Clock, Minus, Plus, CheckCircle2, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import ScreenHeader from '@/components/ScreenHeader';
import FareBreakdownCard from '@/features/mobility/components/FareBreakdownCard';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { errKind } from '@/features/mobility/utils/errKind';
import { useCarHire, useCarHireActions } from '@/features/mobility/hooks/useModes';
import { clearMockActiveCarHire } from '@/features/mobility/api/carhire.api';
import { CARHIRE_PHASE_LABEL, VEHICLE_CLASSES, HIRE_TYPES } from '@/features/mobility/constants/modes.constants';
import { formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import { canCancelCarHire, canEndCarHire, canExtendCarHire, carHireDepositCopy, carHireRefundCopy } from '@/features/mobility/utils/carhireCardDirect';

const startLabel = (iso: string) => new Date(iso).toLocaleString('en-NG', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const classLabel = (v: string) => VEHICLE_CLASSES.find((c) => c.value === v)?.label ?? v;
const hireLabel = (v: string) => HIRE_TYPES.find((h) => h.value === v)?.label ?? v;

export default function CarHireDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const booking = useCarHire(id, { poll: true });
  const { extend, complete, cancel } = useCarHireActions();
  const [extraHours, setExtraHours] = useState(1);
  const [showExtend, setShowExtend] = useState(false);
  const b = booking.data;

  if (booking.isLoading) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Your hire" /><ScreenHeader title="Your hire" showBack={false} /><StateView kind="loading" message="Loading…" /></SafeAreaView>;
  }
  if (booking.isError || !b) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Your hire" /><MobilityEdgeState kind={errKind(booking.error)} actionLabel="Retry" onAction={() => booking.refetch()} /></SafeAreaView>;
  }

  const completed = b.phase === 'completed';
  const cancelled = b.phase === 'cancelled';
  const card = b.fundingRail === 'card';
  // A card-funded hire can never be extended (the server refuses it); cancel is a
  // pre-activation action on both rails.
  const canExtend = canExtendCarHire(b);
  const canCancel = canCancelCarHire(b);
  const canEnd = canEndCarHire(b);
  const paymentFailed = b.paymentStatus === 'failed';
  const depositCopy = carHireDepositCopy(b);
  const refundCopy = cancelled ? carHireRefundCopy(b.refundStatus, b.fundingRail) : '';
  // Deposit is only "refunded" in the receipt once the backend says it was returned.
  const depositReturned = b.depositStatus === 'returned';

  const onExtend = () => id && extend.mutate({ id, extraHours }, { onSuccess: () => setShowExtend(false) });
  const onComplete = () => id && complete.mutate(id);
  const onCancel = () => id && cancel.mutate(id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Your hire" onBack={() => router.replace('/mobility')} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {paymentFailed && <MobilityEdgeState kind="paymentFailed" compact actionLabel="Top up wallet" onAction={() => router.push('/wallet/add')} />}

        <View style={styles.statusRow}>
          <StatusBadge label={CARHIRE_PHASE_LABEL[b.phase]} tone={completed ? 'success' : b.phase === 'cancelled' ? 'danger' : 'info'} />
        </View>

        {/* Vehicle */}
        <View style={[styles.vehicleCard, shadow1]}>
          <View style={styles.vehicleIcon}><Car size={24} color={Colors.primary} strokeWidth={2.2} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.vehicleLabel}>{b.vehicleLabel}</Text>
            <Text style={styles.vehicleMeta}>{hireLabel(b.hireType)} · {classLabel(b.vehicleClass)}{b.plateNumber ? ` · ${b.plateNumber}` : ''}</Text>
          </View>
        </View>

        <View style={styles.metaCard}>
          <View style={styles.metaRow}><Clock size={16} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.metaText}>Starts {startLabel(b.startAt)}</Text></View>
          <View style={styles.metaRow}><Clock size={16} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.metaText}>Duration {b.durationHours} hours</Text></View>
          {b.chauffeur && b.driverName && <View style={styles.metaRow}><UserCheck size={16} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.metaText}>Chauffeur {b.driverName}</Text></View>}
        </View>

        {!completed && !cancelled && (
          <View style={styles.escrowRow}>
            <ShieldCheck size={16} color={Colors.tertiaryContainer} strokeWidth={2.2} />
            <Text style={styles.escrowText}>{depositCopy || `${formatNairaWhole(b.depositKobo)} deposit held in escrow — refunded on completion.`}</Text>
          </View>
        )}
        {cancelled && !!refundCopy && (
          <View style={styles.escrowRow}>
            <ShieldCheck size={16} color={Colors.tertiaryContainer} strokeWidth={2.2} />
            <Text style={styles.escrowText}>{refundCopy}</Text>
          </View>
        )}

        <FareBreakdownCard
          title={completed ? 'Receipt' : 'Charges'}
          fareKobo={b.fareKobo + b.chauffeurKobo}
          rows={[
            { label: 'Hire fare', valueKobo: b.fareKobo },
            ...(b.chauffeurKobo > 0 ? [{ label: 'Chauffeur', valueKobo: b.chauffeurKobo }] : []),
            { label: completed ? (depositReturned ? (card ? 'Deposit sent back to your card' : 'Deposit refunded') : 'Deposit (being returned)') : 'Deposit (held)', valueKobo: b.depositKobo },
          ]}
        />

        {completed && (
          <View style={styles.doneCard}>
            <CheckCircle2 size={40} color={Colors.tertiaryContainer} strokeWidth={2} />
            <Text style={styles.doneTitle}>Hire complete</Text>
            <Text style={styles.doneSub}>{depositCopy || 'Your deposit is being returned.'}</Text>
          </View>
        )}

        {/* Extend panel */}
        {showExtend && canExtend && (
          <View style={styles.extendCard}>
            <Text style={styles.extendTitle}>Extend your hire</Text>
            <View style={styles.stepper}>
              <Pressable style={styles.stepBtn} onPress={() => setExtraHours((h) => Math.max(1, h - 1))} disabled={extraHours <= 1}><Minus size={18} color={extraHours <= 1 ? Colors.outline : Colors.primary} strokeWidth={2.4} /></Pressable>
              <Text style={styles.stepValue}>+{extraHours}h</Text>
              <Pressable style={styles.stepBtn} onPress={() => setExtraHours((h) => Math.min(24, h + 1))}><Plus size={18} color={Colors.primary} strokeWidth={2.4} /></Pressable>
            </View>
            <PrimaryButton label="Confirm extension" onPress={onExtend} loading={extend.isPending} />
            <Pressable onPress={() => setShowExtend(false)} style={styles.cancelExtend}><Text style={styles.cancelExtendLabel}>Cancel</Text></Pressable>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {completed || cancelled ? (
          <PrimaryButton label="Done" onPress={() => { clearMockActiveCarHire(); router.replace('/mobility'); }} />
        ) : (
          <>
            {canExtend && !showExtend && <PrimaryButton label="Extend hire" variant="secondary" onPress={() => setShowExtend(true)} />}
            {card && <Text style={styles.cardNote}>Paid by card — this hire can't be extended. Book a new hire for extra time.</Text>}
            {canCancel && <PrimaryButton label="Cancel booking" variant="secondary" onPress={onCancel} loading={cancel.isPending} />}
            {canEnd && <PrimaryButton label="End hire" onPress={onComplete} loading={complete.isPending} />}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.md },
  statusRow: { flexDirection: 'row' },
  vehicleCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  vehicleIcon: { width: 52, height: 52, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  vehicleLabel: { ...Typography.labelLg, color: Colors.onSurface },
  vehicleMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  metaCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  metaText: { ...Typography.labelMd, color: Colors.onSurface },
  escrowRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.tertiaryFixed, borderRadius: Radius.lg, padding: Spacing.md },
  escrowText: { ...Typography.labelSm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  doneCard: { alignItems: 'center', gap: 6, paddingVertical: Spacing.md },
  doneTitle: { ...Typography.headlineMd, color: Colors.onSurface, marginTop: Spacing.xs },
  doneSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  extendCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant, gap: Spacing.md },
  extendTitle: { ...Typography.labelLg, color: Colors.onSurface },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  stepBtn: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.outlineVariant },
  stepValue: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' as const, minWidth: 56, textAlign: 'center' },
  cardNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  cancelExtend: { height: 40, alignItems: 'center', justifyContent: 'center' },
  cancelExtendLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.sm },
});
