import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RotateCcw, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, StatusBadge } from '@/features/doctor/components';
import { usePetRefillRequests, useReviewPetRefill } from '@/features/doctor/hooks';
import { PET_REFILL_STATUS_LABELS, PET_SPECIES_LABELS } from '@/features/doctor/constants';
import type { StatusTone } from '@/features/doctor/components';
import type { PetRefillRequest, PetRefillStatus } from '@/types/doctor.batch5';

const STATUS_TONE: Record<PetRefillStatus, StatusTone> = {
  requested: 'warning', approved: 'success', rejected: 'danger',
};

const REJECT_REASONS = ['Needs re-examination', 'Dose under review', 'Allergy concern', 'Already dispensed', 'Other'];

export default function PetRefillsScreen() {
  const { data: refills = [], isLoading, isError, refetch, isPlaceholderData } = usePetRefillRequests();
  const review = useReviewPetRefill();

  const [rejectTarget, setRejectTarget] = useState<PetRefillRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const approve = async (req: PetRefillRequest) => {
    try {
      await review.mutateAsync({ refillId: req.id, approve: true });
      Alert.alert('Refill approved', `${req.ref} has been approved.`);
    } catch { Alert.alert('Failed', 'Please try again.'); }
  };

  const reject = async () => {
    if (!rejectTarget) return;
    if (!rejectReason) { Alert.alert('Select a reason', 'Choose why you are rejecting.'); return; }
    try {
      await review.mutateAsync({ refillId: rejectTarget.id, approve: false, rejectReason });
      setRejectTarget(null); setRejectReason('');
      Alert.alert('Refill rejected', 'The owner has been notified.');
    } catch { Alert.alert('Failed', 'Please try again.'); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Pet Refill Requests" />

      {isLoading && isPlaceholderData ? (
        <StateView variant="loading" label="Loading refill requests" />
      ) : isError ? (
        <StateView variant="error" message="We could not load refill requests." onRetry={() => refetch()} />
      ) : refills.length === 0 ? (
        <StateView variant="empty" icon={RotateCcw} title="No refill requests" message="Owner refill requests will appear here." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.list}>
            {refills.map((r) => (
              <SectionCard key={r.id} style={styles.card}>
                <View style={styles.head}>
                  <View style={styles.headBody}>
                    <Text style={styles.ref}>{r.ref}</Text>
                    <Text style={styles.meta} numberOfLines={1}>{r.petName} ({PET_SPECIES_LABELS[r.petSpecies]}) - {r.ownerName}</Text>
                  </View>
                  <StatusBadge label={PET_REFILL_STATUS_LABELS[r.status]} tone={STATUS_TONE[r.status]} />
                </View>
                <Text style={styles.drug}>{r.drugSummary}</Text>
                <Text style={styles.rxRef}>From {r.prescriptionRef} - requested {new Date(r.requestedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}</Text>
                {r.status === 'rejected' && !!r.rejectReason && <Text style={styles.rejected}>Rejected: {r.rejectReason}</Text>}

                {r.status === 'requested' && (
                  <View style={styles.actions}>
                    <PrimaryButton label="Approve" onPress={() => approve(r)} loading={review.isPending} style={styles.actionBtn} />
                    <PrimaryButton label="Reject" variant="secondary" onPress={() => setRejectTarget(r)} disabled={review.isPending} style={styles.actionBtn} />
                  </View>
                )}
              </SectionCard>
            ))}
          </View>
        </ScrollView>
      )}

      {/* Reject reason sheet */}
      <Modal visible={!!rejectTarget} transparent animationType="slide" onRequestClose={() => setRejectTarget(null)}>
        <Pressable style={styles.backdrop} onPress={() => setRejectTarget(null)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Reject refill</Text>
            <Pressable onPress={() => setRejectTarget(null)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
          </View>
          <SelectField label="Reason" placeholder="Select a reason" value={rejectReason} options={REJECT_REASONS} onChange={setRejectReason} searchable={false} />
          <PrimaryButton label="Submit rejection" onPress={reject} loading={review.isPending} style={styles.actionBtn} />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  list:        { gap: Spacing.md },
  card:        { marginBottom: 0 },
  head:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  headBody:    { flex: 1, gap: 2 },
  ref:         { ...Typography.labelLg, color: Colors.onSurface },
  meta:        { ...Typography.caption, color: Colors.onSurfaceVariant },
  drug:        { ...Typography.bodyMd, color: Colors.onSurface, marginTop: Spacing.sm },
  rxRef:       { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },
  rejected:    { ...Typography.bodySm, color: Colors.error, marginTop: Spacing.xs },
  actions:     { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  actionBtn:   { flex: 1, marginTop: 0 },
  backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:       { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: 40 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginBottom: Spacing.md },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  sheetTitle:  { ...Typography.titleMd, color: Colors.onSurface },
});
