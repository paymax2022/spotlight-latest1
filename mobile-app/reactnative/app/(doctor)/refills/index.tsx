import React from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RefreshCw } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { SectionCard, StateView, StatusBadge } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { useRefillRequests, useReviewRefill, useRequestRefillConsultation } from '@/features/doctor/hooks';
import { REFILL_STATUS_LABELS } from '@/features/doctor/constants';
import type { RefillRequest, RefillStatus } from '@/types/doctor.phase2';
import { confirmAsync, alertAsync } from '@/lib/confirm';

const STATUS_TONE: Record<RefillStatus, StatusTone> = {
  pending:  'warning',
  approved: 'success',
  rejected: 'danger',
};

export default function RefillsScreen() {
  const { data: refills = [], isLoading, isError, refetch } = useRefillRequests();
  const review = useReviewRefill();
  const requestConsult = useRequestRefillConsultation();

  // K42 — refill consultation required: when a refill needs a fresh consult.
  const handleRequestConsultation = async (refill: RefillRequest) => {
    const ok = await confirmAsync({
      title: 'Consultation required',
      message: `Ask ${refill.patient.name} to book a consultation before this refill can be approved?`,
      confirmLabel: 'Request consultation',
    });
    if (!ok) return;
    try {
      await requestConsult.mutateAsync({
        prescriptionId: refill.prescriptionRef,
        patientId: refill.patient.id,
        reason: 'Refill requires a fresh consultation before approval.',
      });
      await alertAsync({ title: 'Requested', message: 'The patient has been asked to book a consultation.' });
    } catch {
      await alertAsync({ title: 'Failed', message: 'Please try again.' });
    }
  };

  const handleReview = async (refill: RefillRequest, decision: 'approve' | 'reject') => {
    const ok = await confirmAsync({
      title: decision === 'approve' ? 'Approve refill?' : 'Reject refill?',
      message: `${refill.drugSummary} for ${refill.patient.name}.`,
      confirmLabel: decision === 'approve' ? 'Approve' : 'Reject',
      destructive: decision === 'reject',
    });
    if (!ok) return;
    try {
      await review.mutateAsync({ refillId: refill.id, decision });
    } catch {
      await alertAsync({ title: 'Failed', message: 'Please try again.' });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Refill Requests" />

      {isLoading && refills.length === 0 ? (
        <StateView variant="loading" label="Loading refill requests" />
      ) : isError ? (
        <StateView variant="error" message="We could not load refill requests." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {refills.length === 0 ? (
            <StateView variant="empty" icon={RefreshCw} title="No refill requests" message="Patient refill requests will appear here." />
          ) : (
            refills.map((r) => (
              <SectionCard key={r.id} style={styles.card}>
                <View style={styles.header}>
                  <DoctorAvatar initials={r.patient.initials} color={r.patient.avatarColor} size={44} />
                  <View style={styles.headerBody}>
                    <Text style={styles.name} numberOfLines={1}>{r.patient.name}</Text>
                    <Text style={styles.ref} numberOfLines={1}>{r.ref} · {r.prescriptionRef}</Text>
                  </View>
                  <StatusBadge label={REFILL_STATUS_LABELS[r.status]} tone={STATUS_TONE[r.status]} />
                </View>

                <Text style={styles.drugs}>{r.drugSummary}</Text>
                <Text style={styles.reason} numberOfLines={3}>{r.reason}</Text>
                {!!r.lastDispensedAt && (
                  <Text style={styles.meta}>Last dispensed {new Date(`${r.lastDispensedAt}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                )}
                {r.status === 'rejected' && !!r.rejectionReason && (
                  <Text style={styles.rejection}>Rejected: {r.rejectionReason}</Text>
                )}

                {r.status === 'pending' && (
                  <>
                    <View style={styles.actions}>
                      <PrimaryButton label="Approve" onPress={() => handleReview(r, 'approve')} loading={review.isPending} style={styles.btn} />
                      <PrimaryButton label="Reject" onPress={() => handleReview(r, 'reject')} variant="secondary" disabled={review.isPending} style={styles.btn} />
                    </View>
                    <PrimaryButton label="Consultation required" onPress={() => handleRequestConsultation(r)} variant="ghost" loading={requestConsult.isPending} style={styles.consultBtn} />
                  </>
                )}
              </SectionCard>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24, gap: Spacing.md, flexGrow: 1 },
  card:       {},
  header:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  headerBody: { flex: 1, gap: 2 },
  name:       { ...Typography.titleMd, color: Colors.onSurface },
  ref:        { ...Typography.caption, color: Colors.onSurfaceVariant },
  drugs:      { ...Typography.labelMd, color: Colors.primary, marginBottom: Spacing.xs },
  reason:     { ...Typography.bodyMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  meta:       { ...Typography.caption, color: Colors.onSurfaceVariant },
  rejection:  { ...Typography.bodySm, color: Colors.error, marginTop: Spacing.xs },
  actions:    { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  btn:        { flex: 1 },
  consultBtn: { marginTop: Spacing.sm },
});
