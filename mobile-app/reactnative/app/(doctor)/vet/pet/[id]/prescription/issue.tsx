import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Pill, Send, X, CheckCircle2, History as HistoryIcon, Building2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, StatusBadge, QrCodeView } from '@/features/doctor/components';
import { useIssuedPetPrescription, useIssuePetPrescription, usePetPharmacies, useSendPetRxToPharmacy } from '@/features/doctor/hooks';
import { PET_RX_SEND_STATUS_LABELS, PET_SPECIES_LABELS } from '@/features/doctor/constants';
import type { StatusTone } from '@/features/doctor/components';
import type { PetRxSendStatus, PetRxAuditAction } from '@/types/doctor.batch5';

const SEND_TONE: Record<PetRxSendStatus, StatusTone> = {
  not_sent: 'neutral', sending: 'warning', sent: 'info', received: 'brand', dispensed: 'success', failed: 'danger',
};

const AUDIT_LABELS: Record<PetRxAuditAction, string> = {
  created: 'Created', issued: 'Issued', sent_to_pharmacy: 'Sent to pharmacy', dispensed: 'Dispensed',
  refill_requested: 'Refill requested', refill_approved: 'Refill approved', refill_rejected: 'Refill rejected',
};

export default function IssuePetPrescriptionScreen() {
  const { prescriptionId } = useLocalSearchParams<{ prescriptionId?: string }>();
  const rxId = prescriptionId ? String(prescriptionId) : '';

  const { data: issued, isLoading, isError, refetch } = useIssuedPetPrescription(rxId);
  const { data: pharmacies = [] } = usePetPharmacies();
  const issue = useIssuePetPrescription();
  const send = useSendPetRxToPharmacy();

  const [pharmacyOpen, setPharmacyOpen] = useState(false);

  const handleIssue = async () => {
    if (!issued) return;
    try {
      await issue.mutateAsync({ prescriptionId: issued.prescription.id });
      Alert.alert('Prescription issued', 'The prescription is now issued and can be sent to a pharmacy.');
    } catch { Alert.alert('Failed', 'Could not issue. Please try again.'); }
  };

  const handleSend = async (pharmacyId: string) => {
    if (!issued) return;
    try {
      await send.mutateAsync({ prescriptionId: issued.prescription.id, pharmacyId });
      setPharmacyOpen(false);
      Alert.alert('Sent', 'The prescription has been sent to the pharmacy.');
    } catch { Alert.alert('Failed', 'Could not send to pharmacy. Please try again.'); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Issued Prescription" />

      {isLoading && !issued ? (
        <StateView variant="loading" label="Loading prescription" />
      ) : isError || !issued ? (
        <StateView variant="error" message="We could not load this prescription." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {/* QR + verification (T.10) */}
          <View style={styles.qrWrap}>
            <QrCodeView payload={`petrx:${issued.prescription.ref}`} verificationCode={issued.prescription.ref} />
          </View>

          <SectionCard title="Prescription" style={styles.card}>
            <InfoRow label="Reference" value={issued.prescription.ref} />
            <InfoRow label="Pet" value={`${issued.prescription.petName} (${PET_SPECIES_LABELS[issued.prescription.petSpecies]})`} />
            <InfoRow label="Owner" value={issued.prescription.ownerName} />
            <InfoRow label="Diagnosis" value={issued.prescription.diagnosis} />
            <InfoRow label="Status" value={issued.prescription.status} valueColor={issued.prescription.status === 'issued' ? Colors.teal : Colors.onSurface} />
          </SectionCard>

          <SectionCard title="Medications" style={styles.card}>
            {issued.prescription.items.map((it, i) => (
              <View key={`${it.name}-${i}`} style={[styles.medRow, i > 0 && styles.rowBorder]}>
                <Pill size={16} color={Colors.primary} strokeWidth={2} />
                <View style={styles.medBody}>
                  <Text style={styles.medName}>{it.name} - {it.dosage}</Text>
                  <Text style={styles.medMeta}>{it.route} - {it.frequency} - {it.duration}</Text>
                </View>
              </View>
            ))}
          </SectionCard>

          {/* Send-to-pharmacy status (T.11) */}
          <SectionCard title="Pharmacy" style={styles.card}>
            <View style={styles.sendRow}>
              <Pill size={18} color={Colors.primary} strokeWidth={2} />
              <View style={styles.sendBody}>
                <Text style={styles.sendLabel}>{issued.pharmacy?.name ?? 'Not yet sent to a pharmacy'}</Text>
                {!!issued.pharmacy && <Text style={styles.sendMeta}>{issued.pharmacy.address}</Text>}
              </View>
              <StatusBadge label={PET_RX_SEND_STATUS_LABELS[issued.sendStatus]} tone={SEND_TONE[issued.sendStatus]} />
            </View>
          </SectionCard>

          {/* Audit trail (T.15) */}
          <SectionCard title="Audit trail" style={styles.card}>
            {issued.audit.length === 0 ? (
              <Text style={styles.muted}>No activity recorded.</Text>
            ) : (
              issued.audit.map((a, i) => (
                <View key={`${a.action}-${i}`} style={[styles.auditRow, i > 0 && styles.rowBorder]}>
                  <HistoryIcon size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
                  <View style={styles.auditBody}>
                    <Text style={styles.auditAction}>{AUDIT_LABELS[a.action]}</Text>
                    <Text style={styles.auditMeta}>{a.actor} - {new Date(a.at).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}{a.note ? ` - ${a.note}` : ''}</Text>
                  </View>
                </View>
              ))
            )}
          </SectionCard>

          {issued.prescription.status === 'draft' && (
            <PrimaryButton label="Issue prescription" onPress={handleIssue} loading={issue.isPending} style={styles.btn} />
          )}
          <PrimaryButton
            label="Send to pet pharmacy"
            variant={issued.prescription.status === 'draft' ? 'secondary' : 'primary'}
            onPress={() => setPharmacyOpen(true)}
            disabled={issued.prescription.status === 'draft'}
            style={styles.btn}
          />
        </ScrollView>
      )}

      {/* Pet pharmacy directory + send sheet (T.11 / T.16) */}
      <Modal visible={pharmacyOpen} transparent animationType="slide" onRequestClose={() => setPharmacyOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPharmacyOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Send to pet pharmacy</Text>
            <Pressable onPress={() => setPharmacyOpen(false)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {pharmacies.length === 0 ? (
              <StateView variant="empty" icon={Building2} title="No pharmacies" message="No pet pharmacies are available." />
            ) : (
              pharmacies.map((p) => (
                <Pressable key={p.id} style={styles.pharmaRow} onPress={() => handleSend(p.id)} disabled={send.isPending} accessibilityRole="button" accessibilityLabel={`Send to ${p.name}`}>
                  <View style={styles.pharmaIcon}><Building2 size={18} color={Colors.primary} strokeWidth={2} /></View>
                  <View style={styles.pharmaBody}>
                    <Text style={styles.pharmaName}>{p.name}</Text>
                    <Text style={styles.pharmaMeta} numberOfLines={1}>{p.address}</Text>
                  </View>
                  {p.acceptsEPrescription
                    ? <CheckCircle2 size={18} color={Colors.teal} strokeWidth={2} />
                    : <Send size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />}
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  qrWrap:      { alignItems: 'center', marginBottom: Spacing.lg },
  card:        { marginBottom: Spacing.md },
  medRow:      { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.sm },
  medBody:     { flex: 1, gap: 2 },
  medName:     { ...Typography.labelMd, color: Colors.onSurface },
  medMeta:     { ...Typography.caption, color: Colors.onSurfaceVariant },
  muted:       { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  sendRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  sendBody:    { flex: 1, gap: 2 },
  sendLabel:   { ...Typography.labelMd, color: Colors.onSurface },
  sendMeta:    { ...Typography.caption, color: Colors.onSurfaceVariant },
  auditRow:    { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.sm },
  auditBody:   { flex: 1, gap: 2 },
  auditAction: { ...Typography.labelMd, color: Colors.onSurface },
  auditMeta:   { ...Typography.caption, color: Colors.onSurfaceVariant },
  rowBorder:   { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  btn:         { marginTop: Spacing.sm },
  backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:       { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: 40, maxHeight: '85%' },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginBottom: Spacing.md },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  sheetTitle:  { ...Typography.titleMd, color: Colors.onSurface },
  pharmaRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest, marginBottom: Spacing.sm },
  pharmaIcon:  { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple },
  pharmaBody:  { flex: 1, gap: 2 },
  pharmaName:  { ...Typography.labelMd, color: Colors.onSurface },
  pharmaMeta:  { ...Typography.caption, color: Colors.onSurfaceVariant },
});
