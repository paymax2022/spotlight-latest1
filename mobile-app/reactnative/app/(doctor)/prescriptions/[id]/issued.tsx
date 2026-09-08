import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Share2, History, XCircle, Pill, ChevronRight, X, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, StatusBadge, QrCodeView } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import {
  useIssuedPrescription,
  useSharePrescription,
  useSendToPharmacy,
  useCancelPrescription,
} from '@/features/doctor/hooks';
import {
  RX_LIFECYCLE_LABELS,
  RX_FULFILMENT_OPTION_LABELS,
  RX_CANCEL_REASONS,
  AUDIT_ACTION_LABELS,
  FOOD_TIMING_OPTIONS,
} from '@/features/doctor/constants';
import type { RxLifecycleStatus, RxFulfilmentOption } from '@/types/doctor.batch3';
import { confirmAsync, alertAsync } from '@/lib/confirm';

// ── Section K — Issued prescription detail ────────────────────────────────────
// NEW screen: QrCodeView + verification code (K29), share (K34), send-to-pharmacy
// with fulfilment options (K35/K36), audit-trail sheet (K38), cancel (K32) and
// expired (K31) states. REUSES useIssuedPrescription / useSharePrescription /
// useSendToPharmacy / useCancelPrescription.

const LIFECYCLE_TONE: Record<RxLifecycleStatus, StatusTone> = {
  draft: 'neutral', preview: 'info', signed: 'brand', issued: 'success', expired: 'warning', cancelled: 'danger',
};

const FULFILMENT_OPTIONS: RxFulfilmentOption[] = ['send_to_pharmacy', 'patient_choice', 'print', 'share'];

export default function IssuedPrescriptionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const prescriptionId = String(id);
  const { data: rx, isLoading, isError, refetch } = useIssuedPrescription(prescriptionId);
  const share = useSharePrescription();
  const send = useSendToPharmacy();
  const cancel = useCancelPrescription();

  const [auditOpen, setAuditOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [option, setOption] = useState<RxFulfilmentOption>('send_to_pharmacy');

  const handleShare = async () => {
    try {
      await share.mutateAsync({ prescriptionId, channel: 'link' });
      alertAsync({ title: 'Shared', message: 'A secure link has been shared with the patient.' });
    } catch {
      alertAsync({ title: 'Failed', message: 'Could not share the prescription. Please try again.' });
    }
  };

  const handleSend = async () => {
    try {
      await send.mutateAsync({ prescriptionId, option });
      setSendOpen(false);
      if (option === 'send_to_pharmacy' || option === 'patient_choice') {
        const ok = await confirmAsync({
          title: 'Sent',
          message: 'The prescription has been sent for fulfilment.',
          confirmLabel: 'View pharmacy',
          cancelLabel: 'OK',
        });
        if (ok) router.push('/(doctor)/pharmacy');
      } else {
        alertAsync({ title: 'Done', message: `${RX_FULFILMENT_OPTION_LABELS[option]} completed.` });
      }
    } catch {
      alertAsync({ title: 'Failed', message: 'Could not send the prescription. Please try again.' });
    }
  };

  const handleCancel = async (reason: string) => {
    try {
      await cancel.mutateAsync({ prescriptionId, reason });
      setCancelOpen(false);
      await alertAsync({ title: 'Cancelled', message: 'The prescription has been cancelled.' });
      goBack('/prescriptions');
    } catch {
      alertAsync({ title: 'Failed', message: 'Could not cancel the prescription. Please try again.' });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Prescription" />

      {isLoading && !rx ? (
        <StateView variant="loading" label="Loading prescription" />
      ) : isError || !rx ? (
        <StateView variant="error" message="We could not load this prescription." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <DoctorAvatar initials={rx.base.patient.initials} color={rx.base.patient.avatarColor} size={56} />
            <View style={styles.headerBody}>
              <Text style={styles.patient} numberOfLines={1}>{rx.base.patient.name}</Text>
              <Text style={styles.ref}>{rx.base.ref}</Text>
            </View>
            <StatusBadge label={RX_LIFECYCLE_LABELS[rx.lifecycle]} tone={LIFECYCLE_TONE[rx.lifecycle]} />
          </View>

          {/* K31 — expired / K32 cancelled banner */}
          {rx.lifecycle === 'expired' && (
            <View style={[styles.banner, styles.bannerWarn]}>
              <Text style={styles.bannerText}>This prescription has expired and can no longer be dispensed.</Text>
            </View>
          )}
          {rx.lifecycle === 'cancelled' && (
            <View style={[styles.banner, styles.bannerDanger]}>
              <Text style={styles.bannerText}>This prescription was cancelled.</Text>
            </View>
          )}

          {/* K29 — QR + verification code */}
          {!!rx.verificationCode && rx.lifecycle === 'issued' && (
            <SectionCard style={styles.card}>
              <QrCodeView payload={rx.qrPayload ?? ''} verificationCode={rx.verificationCode} />
              <Text style={styles.qrHint}>Pharmacies scan this code or enter the verification code to dispense.</Text>
            </SectionCard>
          )}

          <SectionCard title="Details" style={styles.card}>
            <InfoRow label="Diagnosis" value={rx.base.diagnosis} />
            <InfoRow label="Doctor" value={rx.base.doctorName} />
            <InfoRow label="Issued" value={new Date(rx.base.issuedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })} />
            {/* K44 — validity window */}
            {!!rx.validUntil && <InfoRow label="Valid until" value={new Date(rx.validUntil).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })} valueColor={rx.lifecycle === 'expired' ? Colors.error : Colors.onSurface} />}
            {!!rx.signature && <InfoRow label="Signed by" value={`${rx.signature.signedBy} · ${rx.signature.mdcnNumber}`} />}
            {!!rx.pharmacyName && <InfoRow label="Pharmacy" value={rx.pharmacyName} />}
          </SectionCard>

          {/* K45 — drug line summary */}
          <SectionCard title="Medications" style={styles.card}>
            {rx.lines.map((l, i) => (
              <View key={i} style={[styles.line, i > 0 && styles.lineBorder]}>
                <Pill size={16} color={Colors.primary} strokeWidth={2} />
                <View style={styles.lineBody}>
                  <Text style={styles.lineName}>{l.base.name} {l.strength}</Text>
                  <Text style={styles.lineMeta}>{l.dosageForm} · {l.route} · {l.base.frequency} · {l.base.duration} · Qty {l.quantity}</Text>
                  <Text style={styles.lineMeta}>{FOOD_TIMING_OPTIONS.find((f) => f.value === l.beforeAfterFood)?.label}</Text>
                  {!!l.specialInstruction && <Text style={styles.lineNote}>{l.specialInstruction}</Text>}
                </View>
              </View>
            ))}
          </SectionCard>

          {rx.lifecycle === 'issued' && (
            <>
              <PrimaryButton label="Send to pharmacy" onPress={() => setSendOpen(true)} loading={send.isPending} style={styles.btn} />
              <Pressable style={styles.secondaryRow} onPress={handleShare} accessibilityRole="button" accessibilityLabel="Share prescription">
                <Share2 size={18} color={Colors.secondary} strokeWidth={2} />
                <Text style={styles.secondaryText}>{share.isPending ? 'Sharing…' : 'Share with patient'}</Text>
              </Pressable>
            </>
          )}

          {/* K38 — audit trail */}
          <Pressable style={styles.linkRow} onPress={() => setAuditOpen(true)} accessibilityRole="button" accessibilityLabel="View audit trail">
            <History size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.linkText}>Audit trail ({rx.audit.length})</Text>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>

          {/* K32 — cancel */}
          {(rx.lifecycle === 'issued' || rx.lifecycle === 'signed') && (
            <Pressable style={styles.cancelRow} onPress={() => setCancelOpen(true)} accessibilityRole="button" accessibilityLabel="Cancel prescription">
              <XCircle size={18} color={Colors.error} strokeWidth={2} />
              <Text style={styles.cancelText}>Cancel prescription</Text>
            </Pressable>
          )}
        </ScrollView>
      )}

      {/* K38 — audit trail sheet */}
      <Modal visible={auditOpen} transparent animationType="slide" onRequestClose={() => setAuditOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setAuditOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Audit trail</Text>
            <Pressable onPress={() => setAuditOpen(false)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close audit trail">
              <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </View>
          <ScrollView style={styles.auditScroll}>
            {(rx?.audit ?? []).map((a, i) => (
              <View key={a.id} style={[styles.auditRow, i > 0 && styles.lineBorder]}>
                <View style={styles.auditDot} />
                <View style={styles.auditBody}>
                  <Text style={styles.auditAction}>{AUDIT_ACTION_LABELS[a.action]}</Text>
                  <Text style={styles.auditMeta}>{a.actor} · {new Date(a.at).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</Text>
                  {!!a.detail && <Text style={styles.auditMeta}>{a.detail}</Text>}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* K35 / K36 — send to pharmacy sheet */}
      <Modal visible={sendOpen} transparent animationType="slide" onRequestClose={() => setSendOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setSendOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Send to pharmacy</Text>
            <Pressable onPress={() => setSendOpen(false)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close send to pharmacy">
              <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </View>
          {FULFILMENT_OPTIONS.map((o) => {
            const active = option === o;
            return (
              <Pressable key={o} style={[styles.optionRow, active && styles.optionRowOn]} onPress={() => setOption(o)} accessibilityRole="radio" accessibilityState={{ selected: active }} accessibilityLabel={RX_FULFILMENT_OPTION_LABELS[o]}>
                <Text style={[styles.optionText, active && styles.optionTextOn]}>{RX_FULFILMENT_OPTION_LABELS[o]}</Text>
                <View style={[styles.radio, active && styles.radioOn]}>{active && <Check size={13} color={Colors.onPrimary} strokeWidth={3} />}</View>
              </Pressable>
            );
          })}
          {option === 'send_to_pharmacy' && (
            <Pressable style={styles.directoryLink} onPress={() => { setSendOpen(false); router.push(`/(doctor)/pharmacy/directory?prescriptionId=${prescriptionId}`); }} accessibilityRole="button" accessibilityLabel="Choose a pharmacy">
              <Text style={styles.directoryText}>Choose a specific pharmacy</Text>
              <ChevronRight size={16} color={Colors.primary} strokeWidth={2} />
            </Pressable>
          )}
          <PrimaryButton label="Confirm" onPress={handleSend} loading={send.isPending} style={styles.btn} />
        </View>
      </Modal>

      {/* K32 — cancel reason sheet */}
      <Modal visible={cancelOpen} transparent animationType="slide" onRequestClose={() => setCancelOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setCancelOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Cancel prescription</Text>
            <Pressable onPress={() => setCancelOpen(false)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close cancel">
              <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </View>
          <Text style={styles.cancelCopy}>Select a reason for cancelling. This is recorded in the audit trail.</Text>
          {RX_CANCEL_REASONS.map((r) => (
            <Pressable key={r} style={styles.reasonRow} onPress={() => handleCancel(r)} disabled={cancel.isPending} accessibilityRole="button" accessibilityLabel={r}>
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
  content:      { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  header:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md },
  headerBody:   { flex: 1, gap: 2 },
  patient:      { ...Typography.titleLg, color: Colors.onSurface },
  ref:          { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  banner:       { padding: Spacing.md, borderRadius: Radius.lg, marginBottom: Spacing.md },
  bannerWarn:   { backgroundColor: Colors.iconBgOrange },
  bannerDanger: { backgroundColor: Colors.errorContainer },
  bannerText:   { ...Typography.labelMd, color: Colors.onSurface },
  card:         { marginBottom: Spacing.md },
  qrHint:       { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.sm },
  line:         { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.sm },
  lineBorder:   { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  lineBody:     { flex: 1, gap: 2 },
  lineName:     { ...Typography.labelLg, color: Colors.onSurface },
  lineMeta:     { ...Typography.caption, color: Colors.onSurfaceVariant },
  lineNote:     { ...Typography.caption, color: Colors.onSurfaceVariant, fontStyle: 'italic' },
  btn:          { marginTop: Spacing.sm },
  secondaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.secondaryContainer, backgroundColor: Colors.surfaceContainerLowest, marginTop: Spacing.sm },
  secondaryText: { ...Typography.labelMd, color: Colors.secondary },
  linkRow:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, height: 52, paddingHorizontal: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, marginTop: Spacing.md },
  linkText:     { flex: 1, ...Typography.labelMd, color: Colors.onSurface },
  cancelRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, marginTop: Spacing.sm },
  cancelText:   { ...Typography.labelMd, color: Colors.error },
  // sheets
  backdrop:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:        { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: 40, maxHeight: '82%' },
  sheetHandle:  { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginBottom: Spacing.md },
  sheetHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  sheetTitle:   { ...Typography.titleMd, color: Colors.onSurface },
  auditScroll:  { maxHeight: 420 },
  auditRow:     { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.sm },
  auditDot:     { width: 8, height: 8, borderRadius: Radius.full, backgroundColor: Colors.primary, marginTop: 6 },
  auditBody:    { flex: 1, gap: 2 },
  auditAction:  { ...Typography.labelMd, color: Colors.onSurface },
  auditMeta:    { ...Typography.caption, color: Colors.onSurfaceVariant },
  optionRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 56, paddingHorizontal: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest, marginBottom: Spacing.sm },
  optionRowOn:  { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  optionText:   { ...Typography.labelMd, color: Colors.onSurface },
  optionTextOn: { color: Colors.primary },
  radio:        { width: 24, height: 24, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  radioOn:      { backgroundColor: Colors.primary, borderColor: Colors.primary },
  directoryLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.sm, marginBottom: Spacing.sm },
  directoryText: { ...Typography.labelMd, color: Colors.primary },
  cancelCopy:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  reasonRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 52, paddingHorizontal: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, marginBottom: Spacing.sm },
  reasonText:   { ...Typography.labelMd, color: Colors.onSurface },
});
