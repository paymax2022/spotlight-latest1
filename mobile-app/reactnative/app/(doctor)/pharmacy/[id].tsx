import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, Alert, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowRightLeft, Truck, MessageSquare, CheckCircle2, Flag, X, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { formatKobo } from '@/api/doctor.phase2.api';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, StatusBadge } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { usePharmacyFulfilment, useReviewSubstitute, useConfirmPatientReceived, useReportPharmacy } from '@/features/doctor/hooks';
import { PHARMACY_STATUS_LABELS, PHARMACY_REPORT_REASONS } from '@/features/doctor/constants';
import type { PharmacyFulfilmentStatus } from '@/types/doctor.phase2';

const STATUS_TONE: Record<PharmacyFulfilmentStatus, StatusTone> = {
  received:             'neutral',
  substitute_requested: 'warning',
  preparing:           'info',
  ready:               'brand',
  dispensed:           'success',
  cancelled:           'danger',
};

export default function PharmacyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const fulfilmentId = String(id);
  const { data: fulfilment, isLoading, isError, refetch } = usePharmacyFulfilment(fulfilmentId);
  const review = useReviewSubstitute();
  const confirmReceived = useConfirmPatientReceived();
  const report = useReportPharmacy();
  const [reportOpen, setReportOpen] = useState(false);

  // L19 — patient-received confirmation.
  const handleConfirmReceived = () => {
    Alert.alert('Confirm receipt?', 'Mark this fulfilment as received by the patient.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        onPress: async () => {
          try {
            await confirmReceived.mutateAsync({ fulfilmentId });
            Alert.alert('Confirmed', 'Marked as received by the patient.');
          } catch {
            Alert.alert('Failed', 'Please try again.');
          }
        },
      },
    ]);
  };

  // L20 — pharmacy complaint / report.
  const handleReport = async (reason: string) => {
    if (!fulfilment) return;
    try {
      await report.mutateAsync({ pharmacyId: fulfilment.pharmacyName, fulfilmentId, reason });
      setReportOpen(false);
      Alert.alert('Reported', 'Your report has been submitted for review.');
    } catch {
      Alert.alert('Failed', 'Please try again.');
    }
  };

  const handleReview = (decision: 'approve' | 'reject') => {
    Alert.alert(
      decision === 'approve' ? 'Approve substitute?' : 'Reject substitute?',
      decision === 'approve'
        ? 'The pharmacy will dispense the proposed substitute.'
        : 'The pharmacy will be asked to dispense the original medication.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: decision === 'approve' ? 'Approve' : 'Reject',
          style: decision === 'reject' ? 'destructive' : 'default',
          onPress: async () => {
            try {
              await review.mutateAsync({ fulfilmentId, decision });
              Alert.alert('Done', `Substitute ${decision === 'approve' ? 'approved' : 'rejected'}.`);
            } catch {
              Alert.alert('Failed', 'Please try again.');
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Pharmacy Request" />

      {isLoading && !fulfilment ? (
        <StateView variant="loading" label="Loading request" />
      ) : isError || !fulfilment ? (
        <StateView variant="error" message="We could not load this request." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <DoctorAvatar initials={fulfilment.patient.initials} color={fulfilment.patient.avatarColor} size={56} />
            <View style={styles.headerBody}>
              <Text style={styles.patient} numberOfLines={1}>{fulfilment.patient.name}</Text>
              <Text style={styles.ref}>{fulfilment.ref}</Text>
            </View>
            <StatusBadge label={PHARMACY_STATUS_LABELS[fulfilment.status]} tone={STATUS_TONE[fulfilment.status]} />
          </View>

          <SectionCard title="Request details" style={styles.card}>
            <InfoRow label="Pharmacy" value={fulfilment.pharmacyName} />
            <InfoRow label="Prescription" value={fulfilment.prescriptionRef} />
            <InfoRow label="Requested" value={new Date(fulfilment.requestedAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} />
          </SectionCard>

          {fulfilment.substitute && (
            <SectionCard title="Proposed substitution" style={styles.card}>
              <View style={styles.swapRow}>
                <View style={styles.swapCol}>
                  <Text style={styles.swapLabel}>Original</Text>
                  <Text style={styles.swapValue}>{fulfilment.substitute.originalName}</Text>
                </View>
                <ArrowRightLeft size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
                <View style={styles.swapCol}>
                  <Text style={styles.swapLabel}>Substitute</Text>
                  <Text style={[styles.swapValue, styles.swapValueNew]}>{fulfilment.substitute.substituteName}</Text>
                </View>
              </View>
              <InfoRow label="Dosage" value={fulfilment.substitute.dosage} />
              <InfoRow label="Reason" value={fulfilment.substitute.reason} />
              <InfoRow
                label="Price difference"
                value={`${fulfilment.substitute.priceDeltaKobo > 0 ? '+' : fulfilment.substitute.priceDeltaKobo < 0 ? '-' : ''}${formatKobo(Math.abs(fulfilment.substitute.priceDeltaKobo))}`}
                valueColor={fulfilment.substitute.priceDeltaKobo > 0 ? Colors.error : fulfilment.substitute.priceDeltaKobo < 0 ? Colors.teal : Colors.onSurface}
              />
              {!!fulfilment.substitute.pharmacistNote && <InfoRow label="Pharmacist" value={fulfilment.substitute.pharmacistNote} />}
            </SectionCard>
          )}

          {fulfilment.status === 'substitute_requested' && fulfilment.substitute && (
            <View style={styles.actions}>
              <PrimaryButton label="Approve substitute" onPress={() => handleReview('approve')} loading={review.isPending} style={styles.btn} />
              <PrimaryButton label="Reject substitute" onPress={() => handleReview('reject')} variant="secondary" disabled={review.isPending} style={styles.btn} />
            </View>
          )}

          {/* L13–L16 — fulfilment lifecycle note (partial / awaiting payment / HMO / delivery) */}
          {(fulfilment.status === 'preparing' || fulfilment.status === 'ready') && (
            <View style={styles.statusNote}>
              <Text style={styles.statusNoteText}>
                {fulfilment.status === 'ready'
                  ? 'Ready for dispensing — awaiting delivery to the patient.'
                  : 'Being prepared by the pharmacy. Some items may be partially dispensed or awaiting payment / HMO authorisation.'}
              </Text>
            </View>
          )}

          <Pressable
            style={styles.deliveryLink}
            onPress={() => router.push(`/(doctor)/pharmacy/${fulfilmentId}/delivery`)}
            accessibilityRole="button"
            accessibilityLabel="Track delivery"
          >
            <Truck size={18} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.deliveryText}>Track delivery</Text>
          </Pressable>

          {/* L12 / L21 — pharmacy clarification chat */}
          <Pressable
            style={styles.deliveryLink}
            onPress={() => router.push(`/(doctor)/pharmacy/${fulfilmentId}/chat`)}
            accessibilityRole="button"
            accessibilityLabel="Message pharmacy"
          >
            <MessageSquare size={18} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.deliveryText}>Message pharmacy</Text>
          </Pressable>

          {/* L19 — patient-received confirmation */}
          {(fulfilment.status === 'dispensed' || fulfilment.status === 'ready') && (
            <Pressable style={styles.deliveryLink} onPress={handleConfirmReceived} accessibilityRole="button" accessibilityLabel="Confirm patient received">
              <CheckCircle2 size={18} color={Colors.teal} strokeWidth={2} />
              <Text style={styles.deliveryText}>{confirmReceived.isPending ? 'Confirming…' : 'Confirm patient received'}</Text>
            </Pressable>
          )}

          {/* L20 — report pharmacy */}
          <Pressable style={styles.reportRow} onPress={() => setReportOpen(true)} accessibilityRole="button" accessibilityLabel="Report pharmacy">
            <Flag size={18} color={Colors.error} strokeWidth={2} />
            <Text style={styles.reportText}>Report a problem</Text>
          </Pressable>
        </ScrollView>
      )}

      {/* L20 — report reason sheet */}
      <Modal visible={reportOpen} transparent animationType="slide" onRequestClose={() => setReportOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setReportOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Report pharmacy</Text>
            <Pressable onPress={() => setReportOpen(false)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close report">
              <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </View>
          {PHARMACY_REPORT_REASONS.map((r) => (
            <Pressable key={r} style={styles.reasonRow} onPress={() => handleReport(r)} disabled={report.isPending} accessibilityRole="button" accessibilityLabel={r}>
              <Text style={styles.reasonText}>{r}</Text>
              <ChevronRight size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          ))}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: Colors.background },
  content:      { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  header:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg },
  headerBody:   { flex: 1, gap: 2 },
  patient:      { ...Typography.titleLg, color: Colors.onSurface },
  ref:          { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  card:         { marginBottom: Spacing.md },
  swapRow:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  swapCol:      { flex: 1, gap: 2 },
  swapLabel:    { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  swapValue:    { ...Typography.labelLg, color: Colors.onSurface },
  swapValueNew: { color: Colors.primary },
  actions:      { gap: Spacing.sm, marginBottom: Spacing.md },
  btn:          {},
  deliveryLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.sm },
  deliveryText: { ...Typography.labelMd, color: Colors.onSurface },
  statusNote:   { padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.iconBgBlue, marginBottom: Spacing.md },
  statusNoteText: { ...Typography.labelSm, color: Colors.onSurface },
  reportRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, marginTop: Spacing.xs },
  reportText:   { ...Typography.labelMd, color: Colors.error },
  backdrop:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:        { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: 40, maxHeight: '82%' },
  sheetHandle:  { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginBottom: Spacing.md },
  sheetHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  sheetTitle:   { ...Typography.titleMd, color: Colors.onSurface },
  reasonRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 52, paddingHorizontal: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, marginBottom: Spacing.sm },
  reasonText:   { ...Typography.labelMd, color: Colors.onSurface },
});
