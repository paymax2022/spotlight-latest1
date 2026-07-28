import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { FileText, FlaskConical, ClipboardList, Users, X } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, StatusBadge } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { useIncomingReferral, useAcceptReferral, useRejectReferral } from '@/features/doctor/hooks';
import { INCOMING_REFERRAL_STATUS_LABELS, REFERRAL_ATTACHMENT_KIND_LABELS, REFERRAL_REJECTION_REASONS } from '@/features/doctor/constants';
import type { ReferralAttachmentKind } from '@/types/doctor.phase2';

const toTone = (tone: string): StatusTone => (tone === 'muted' ? 'neutral' : (tone as StatusTone));

const ATTACHMENT_ICON: Record<ReferralAttachmentKind, LucideIcon> = {
  note:         FileText,
  lab:          FlaskConical,
  prescription: ClipboardList,
};

// Section P (P11) — incoming referral case detail with accept / reject and a
// care-team chat entry point.
export default function IncomingReferralDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const referralId = String(id);
  const { data: ref, isLoading, isError, refetch } = useIncomingReferral(referralId);
  const accept = useAcceptReferral();
  const reject = useRejectReferral();
  const [rejectOpen, setRejectOpen] = useState(false);

  const handleAccept = async () => {
    try {
      await accept.mutateAsync({ referralId });
      Alert.alert('Referral accepted', 'The referring doctor has been notified.');
    } catch {
      Alert.alert('Failed', 'Please try again.');
    }
  };

  const handleReject = async (reason: string) => {
    try {
      await reject.mutateAsync({ referralId, rejectionReason: reason });
      setRejectOpen(false);
      Alert.alert('Referral rejected', 'The referring doctor has been notified.');
    } catch {
      Alert.alert('Failed', 'Please try again.');
    }
  };

  const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Incoming Referral" />

      {isLoading && !ref ? (
        <StateView variant="loading" label="Loading referral" />
      ) : isError || !ref ? (
        <StateView variant="error" message="We could not load this referral." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <DoctorAvatar initials={ref.patient.initials} color={ref.patient.avatarColor} size={56} />
            <View style={styles.headerBody}>
              <Text style={styles.patient} numberOfLines={1}>{ref.patient.name}</Text>
              <Text style={styles.sub}>{ref.ref} · {ref.specialty}</Text>
            </View>
            <StatusBadge label={INCOMING_REFERRAL_STATUS_LABELS[ref.status].label} tone={toTone(INCOMING_REFERRAL_STATUS_LABELS[ref.status].tone)} />
          </View>

          <SectionCard title="Referral details" style={styles.card}>
            <InfoRow label="From" value={ref.fromDoctor} />
            {!!ref.fromHospital && <InfoRow label="Hospital" value={ref.fromHospital} />}
            <InfoRow label="Specialty requested" value={ref.specialty} />
            <InfoRow label="Urgency" value={ref.urgency === 'urgent' ? 'Urgent' : 'Routine'} valueColor={ref.urgency === 'urgent' ? Colors.error : Colors.onSurface} />
            <InfoRow label="Received" value={fmtDate(ref.receivedAt)} />
            {!!ref.decidedAt && <InfoRow label="Decided" value={fmtDate(ref.decidedAt)} />}
          </SectionCard>

          <SectionCard title="Reason" style={styles.card}>
            <Text style={styles.body}>{ref.reason}</Text>
          </SectionCard>

          <SectionCard title="Attachments" style={styles.card}>
            {ref.attachments.length === 0 ? (
              <Text style={styles.muted}>No attachments included.</Text>
            ) : (
              ref.attachments.map((a, i) => {
                const Icon = ATTACHMENT_ICON[a.kind];
                return (
                  <View key={a.id} style={[styles.attachRow, i > 0 && styles.rowBorder]}>
                    <Icon size={16} color={Colors.primary} strokeWidth={2} />
                    <View style={styles.attachBody}>
                      <Text style={styles.attachLabel}>{a.label}</Text>
                      <Text style={styles.attachKind}>{REFERRAL_ATTACHMENT_KIND_LABELS[a.kind]}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </SectionCard>

          {ref.status === 'rejected' && !!ref.rejectionReason && (
            <SectionCard title="Rejection reason" style={styles.card}>
              <Text style={styles.rejection}>{ref.rejectionReason}</Text>
            </SectionCard>
          )}

          {/* P14 — care-team chat entry point */}
          <Pressable style={styles.link} onPress={() => router.push(`/(doctor)/referrals/${ref.ref}/care-team`)} accessibilityRole="button" accessibilityLabel="Open care team">
            <Users size={18} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.linkText}>Care team & shared case summary</Text>
          </Pressable>

          {/* P11 — accept / reject (incoming state only) */}
          {ref.status === 'incoming' && (
            <View style={styles.actions}>
              <PrimaryButton label="Accept case" onPress={handleAccept} loading={accept.isPending} style={styles.btn} />
              <PrimaryButton label="Reject" onPress={() => setRejectOpen(true)} variant="secondary" disabled={accept.isPending} style={styles.btn} />
            </View>
          )}
        </ScrollView>
      )}

      <Modal visible={rejectOpen} transparent animationType="slide" onRequestClose={() => setRejectOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setRejectOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Reject referral</Text>
            <Pressable onPress={() => setRejectOpen(false)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
          </View>
          <RejectPicker pending={reject.isPending} onConfirm={handleReject} />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function RejectPicker({ pending, onConfirm }: { pending: boolean; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <>
      <SelectField label="Reason" placeholder="Select a reason" value={reason} options={REFERRAL_REJECTION_REASONS} onChange={setReason} searchable={false} />
      <PrimaryButton label="Confirm rejection" onPress={() => onConfirm(reason)} loading={pending} disabled={!reason} style={styles.btn} />
    </>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  header:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg },
  headerBody:  { flex: 1, gap: 2 },
  patient:     { ...Typography.titleLg, color: Colors.onSurface },
  sub:         { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  card:        { marginBottom: Spacing.md },
  body:        { ...Typography.bodyMd, color: Colors.onSurface },
  muted:       { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  rejection:   { ...Typography.bodyMd, color: Colors.error },
  attachRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  rowBorder:   { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  attachBody:  { flex: 1, gap: 2 },
  attachLabel: { ...Typography.labelMd, color: Colors.onSurface },
  attachKind:  { ...Typography.caption, color: Colors.onSurfaceVariant },
  link:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, height: 52, paddingHorizontal: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.md },
  linkText:    { ...Typography.labelMd, color: Colors.onSurface },
  actions:     { gap: Spacing.sm },
  btn:         { marginTop: Spacing.sm },
  backdrop:    { flex: 1, backgroundColor: 'rgba(11,28,48,0.4)' },
  sheet:       { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.sm },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, marginBottom: Spacing.sm },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, marginBottom: Spacing.xs },
  sheetTitle:  { ...Typography.titleMd, color: Colors.onSurface },
});
