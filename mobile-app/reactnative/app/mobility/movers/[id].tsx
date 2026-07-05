import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Star, Truck, CheckCircle2, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import ScreenHeader from '@/components/ScreenHeader';
import TripRouteCard from '@/features/mobility/components/TripRouteCard';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useMoverJob, useMoverActions } from '@/features/mobility/hooks/useModes';
import { usePurchasePayment, PaymentSheet } from '@/features/payments';
import { MOVER_PHASE_LABEL, TRUCK_SIZES } from '@/features/mobility/constants/modes.constants';
import { formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import type { MoverBid } from '@/features/mobility/types/modes.types';

const truckLabel = (v: string) => TRUCK_SIZES.find((t) => t.value === v)?.label ?? v;
const dateLabel = (iso: string) => new Date(iso).toLocaleDateString('en-NG', { weekday: 'short', day: '2-digit', month: 'short' });

export default function MoverJobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const job = useMoverJob(id, { poll: true });
  const { acceptBid, confirmCompletion } = useMoverActions();
  // Shared chooser: fund the escrow from wallet OR top up the bid amount via
  // card (Paystack) first. The accept (escrow-fund) charge runs inside `charge`.
  const pay = usePurchasePayment<Awaited<ReturnType<typeof acceptBid.mutateAsync>>>();
  const j = job.data;

  if (job.isLoading) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Your move" showBack={false} /><StateView kind="loading" message="Loading your move…" /></SafeAreaView>;
  }
  if (job.isError || !j) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Your move" /><MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => job.refetch()} /></SafeAreaView>;
  }

  const onAccept = (bid: MoverBid) => {
    if (!id) return;
    pay.start({
      amountKobo: bid.amountKobo,
      title: 'Fund escrow',
      // Existing accept-bid escrow charge (with its Idempotency-Key) runs unchanged.
      charge: () => acceptBid.mutateAsync({ id, bidId: bid.id }),
      // Job auto-refreshes via polling; nothing else to do on success.
    });
  };
  const onConfirm = () => id && confirmCompletion.mutate(id, {
    onSuccess: () => { if (!j.rated) router.replace(`/mobility/movers/${j.id}/rate`); else router.replace('/mobility'); },
  });

  const tone = j.phase === 'completion_confirmed' ? 'success' : j.phase === 'cancelled' || j.phase === 'disputed' ? 'danger' : 'info';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Your move" onBack={() => router.replace('/mobility')} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.statusRow}>
          <StatusBadge label={MOVER_PHASE_LABEL[j.phase]} tone={tone} />
          <Text style={styles.meta}>{truckLabel(j.truckSize)} · {j.helpers} helper{j.helpers !== 1 ? 's' : ''}</Text>
        </View>

        <TripRouteCard pickup={j.pickup} dest={j.dropoff} />
        <View style={styles.metaCard}>
          <Text style={styles.metaLabel}>Move date</Text>
          <Text style={styles.metaValue}>{dateLabel(j.moveAt)}</Text>
        </View>

        {/* Awaiting bids */}
        {j.phase === 'quote_requested' && (
          <View style={styles.waitCard}>
            <StateView kind="loading" compact message="Collecting bids from providers…" />
          </View>
        )}

        {/* Bids list */}
        {j.phase === 'bids_received' && (
          <>
            <Text style={styles.section}>{j.bids.length} bid{j.bids.length !== 1 ? 's' : ''} received</Text>
            {j.bids.map((bid: MoverBid) => (
              <View key={bid.id} style={[styles.bidCard, shadow1]}>
                <View style={styles.bidHead}>
                  <View style={styles.bidIcon}><Truck size={18} color={Colors.primary} strokeWidth={2.2} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.bidProvider}>{bid.providerName}</Text>
                    <View style={styles.ratingRow}>
                      <Star size={12} color={Colors.gold} fill={Colors.gold} strokeWidth={0} />
                      <Text style={styles.ratingText}>{bid.providerRating.toFixed(1)} · {bid.reviews} reviews</Text>
                    </View>
                  </View>
                  <Text style={styles.bidAmount}>{formatNairaWhole(bid.amountKobo)}</Text>
                </View>
                <Text style={styles.bidNote}>{bid.etaNote}</Text>
                <PrimaryButton label="Accept & fund escrow" onPress={() => onAccept(bid)} loading={acceptBid.isPending} />
              </View>
            ))}
          </>
        )}

        {/* Accepted / in progress */}
        {j.acceptedBid && ['bid_accepted', 'crew_assigned', 'in_progress', 'completion_confirmed'].includes(j.phase) && (
          <View style={[styles.acceptedCard, shadow1]}>
            <View style={styles.escrowRow}>
              <ShieldCheck size={16} color={Colors.tertiaryContainer} strokeWidth={2.2} />
              <Text style={styles.escrowText}>{formatNairaWhole(j.fareKobo ?? j.acceptedBid.amountKobo)} held in escrow with {j.acceptedBid.providerName}</Text>
            </View>
            {j.phase === 'in_progress' && <Text style={styles.progressNote}>Your crew is on the job. Confirm completion once everything is delivered to release payment.</Text>}
            {j.phase === 'crew_assigned' && <Text style={styles.progressNote}>Crew assigned. They will arrive on your move date.</Text>}
          </View>
        )}

        {/* Completed */}
        {j.phase === 'completion_confirmed' && (
          <View style={styles.doneCard}>
            <CheckCircle2 size={40} color={Colors.tertiaryContainer} strokeWidth={2} />
            <Text style={styles.doneTitle}>Move complete</Text>
            <Text style={styles.doneSub}>Escrow released to your provider.</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {j.phase === 'in_progress' ? (
          <PrimaryButton label="Confirm completion & release payment" onPress={onConfirm} loading={confirmCompletion.isPending} />
        ) : j.phase === 'completion_confirmed' ? (
          <PrimaryButton label="Done" onPress={() => router.replace('/mobility')} />
        ) : null}
      </View>

      {/* Shared wallet/card chooser — funds the escrow on bid acceptance. */}
      <PaymentSheet controller={pay} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  metaCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  metaLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  metaValue: { ...Typography.labelLg, color: Colors.onSurface },
  waitCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, paddingVertical: Spacing.lg },
  section: { ...Typography.labelLg, color: Colors.onSurface },
  bidCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant, gap: Spacing.md },
  bidHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  bidIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  bidProvider: { ...Typography.labelLg, color: Colors.onSurface },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  ratingText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  bidAmount: { ...Typography.titleMd, color: Colors.primary, fontWeight: '800' as const },
  bidNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  acceptedCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant, gap: Spacing.sm },
  escrowRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  escrowText: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  progressNote: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 20 },
  doneCard: { alignItems: 'center', gap: 6, paddingVertical: Spacing.md },
  doneTitle: { ...Typography.headlineMd, color: Colors.onSurface, marginTop: Spacing.xs },
  doneSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
});
