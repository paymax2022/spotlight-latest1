import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Modal, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { X, Check, Inbox, CheckCircle2, XCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import TextInputField from '@/components/TextInputField';
import DatePickerField from '@/components/DatePickerField';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { SectionCard, StateView, InfoRow, StatusBadge } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { useAppointmentRequest, useAcceptAppointment, useRejectAppointment, useRequestReschedule } from '@/features/doctor/hooks';
import { APPOINTMENT_REJECT_REASONS, APPOINTMENT_BILLING_LABELS, QUEUE_PRIORITY_LABELS } from '@/features/doctor/constants';
import { formatKobo } from '@/api/doctor.batch1.api';
import type { AppointmentBilling, QueuePriority, AppointmentRequestStatus } from '@/types/doctor.batch1';

const BILLING_TONE: Record<AppointmentBilling, StatusTone> = { hmo: 'brand', paid: 'success', free_follow_up: 'info' };
const PRIORITY_TONE: Record<QueuePriority, StatusTone> = { emergency: 'danger', high: 'warning', normal: 'info', low: 'neutral' };
const STATUS_TONE: Record<AppointmentRequestStatus, StatusTone> = { pending: 'info', accepted: 'success', rejected: 'danger', reschedule_requested: 'warning' };
const STATUS_LABEL: Record<AppointmentRequestStatus, string> = { pending: 'Pending', accepted: 'Accepted', rejected: 'Rejected', reschedule_requested: 'Reschedule requested' };

export default function AppointmentRequestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: request, isLoading, isError, refetch } = useAppointmentRequest(id);

  const accept = useAcceptAppointment();
  const reject = useRejectAppointment();
  const requestReschedule = useRequestReschedule();

  const [sheet, setSheet] = useState<null | 'reject' | 'reschedule'>(null);
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  const [proposedDate, setProposedDate] = useState<string | undefined>();
  const [proposedTime, setProposedTime] = useState('');
  const [note, setNote] = useState('');

  const closeSheet = () => { setSheet(null); setReasonCode(null); setProposedDate(undefined); setProposedTime(''); setNote(''); };

  const onAccept = async () => {
    if (!request) return;
    try { await accept.mutateAsync({ appointmentId: request.appointment.id }); Alert.alert('Accepted', 'The appointment has been accepted.'); } catch { Alert.alert('Failed', 'Could not accept the request.'); }
  };
  const onReject = async () => {
    if (!request) return;
    const reason = APPOINTMENT_REJECT_REASONS.find((r) => r.code === reasonCode)?.label ?? 'Declined';
    try { await reject.mutateAsync({ appointmentId: request.appointment.id, reason }); closeSheet(); Alert.alert('Declined', 'The request has been declined.'); } catch { Alert.alert('Failed', 'Could not decline the request.'); }
  };
  const onRequestReschedule = async () => {
    if (!request || !proposedDate || !proposedTime.trim()) { Alert.alert('Incomplete', 'Choose a date and time to propose.'); return; }
    try { await requestReschedule.mutateAsync({ appointmentId: request.appointment.id, proposedSlotDate: proposedDate, proposedSlotTime: proposedTime.trim(), note: note || undefined }); closeSheet(); Alert.alert('Sent', 'A reschedule has been proposed to the patient.'); } catch { Alert.alert('Failed', 'Could not propose a reschedule.'); }
  };

  if (isLoading && !request) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Request" />
        <StateView variant="loading" label="Loading request" />
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Request" />
        <StateView variant="error" message="We could not load this request." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  if (!request) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Request" />
        <StateView variant="empty" icon={Inbox} title="Request not found" message="This request may have been withdrawn or already handled." />
      </SafeAreaView>
    );
  }

  const a = request.appointment;
  const isPending = request.status === 'pending';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Request" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <DoctorAvatar initials={a.patient.initials} color={a.patient.avatarColor} size={64} />
          <Text style={styles.name}>{a.patient.name}</Text>
          <View style={styles.badges}>
            <StatusBadge label={STATUS_LABEL[request.status]} tone={STATUS_TONE[request.status]} />
            <StatusBadge label={QUEUE_PRIORITY_LABELS[request.priority]} tone={PRIORITY_TONE[request.priority]} />
            <StatusBadge label={APPOINTMENT_BILLING_LABELS[request.billing]} tone={BILLING_TONE[request.billing]} />
          </View>
        </View>

        <SectionCard title="Requested slot" style={styles.card}>
          <InfoRow label="Date" value={new Date(`${a.slotDate}T00:00:00`).toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' })} />
          <InfoRow label="Time" value={a.slotTime} />
          <InfoRow label="Type" value={a.consultType} />
          <InfoRow label="Fee" value={request.billing === 'free_follow_up' ? 'Free follow-up' : formatKobo(a.feeKobo)} />
          {!!a.reason && <InfoRow label="Reason" value={a.reason} />}
        </SectionCard>

        {!!request.patientNote && (
          <SectionCard title="Patient note" style={styles.card}>
            <Text style={styles.note}>{request.patientNote}</Text>
          </SectionCard>
        )}

        {/* F5/F6/F7 — accept / reject / reschedule actions (state from status) */}
        {isPending ? (
          <View style={styles.actions}>
            <PrimaryButton label="Accept request" onPress={onAccept} loading={accept.isPending} style={styles.btn} />
            <PrimaryButton label="Propose reschedule" onPress={() => setSheet('reschedule')} variant="secondary" style={styles.btn} />
            <Pressable style={styles.rejectBtn} onPress={() => setSheet('reject')} accessibilityRole="button" accessibilityLabel="Decline request">
              <XCircle size={16} color={Colors.error} strokeWidth={2} />
              <Text style={styles.rejectText}>Decline request</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.resolved}>
            {request.status === 'accepted' ? <CheckCircle2 size={18} color={Colors.teal} strokeWidth={2} /> : <XCircle size={18} color={Colors.error} strokeWidth={2} />}
            <Text style={styles.resolvedText}>
              {request.status === 'accepted' ? 'You accepted this request.' : request.status === 'rejected' ? `Declined${request.rejectionReason ? `: ${request.rejectionReason}` : ''}.` : 'A reschedule has been proposed.'}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* F6 — reject sheet */}
      <Modal visible={sheet === 'reject'} transparent animationType="slide" onRequestClose={closeSheet}>
        <Pressable style={styles.backdrop} onPress={closeSheet} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Decline request</Text>
            <Pressable onPress={closeSheet} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
          </View>
          {APPOINTMENT_REJECT_REASONS.map((r) => {
            const on = reasonCode === r.code;
            return (
              <Pressable key={r.code} onPress={() => setReasonCode(r.code)} style={[styles.reasonRow, on && styles.reasonRowOn]} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={r.label}>
                <Text style={[styles.reasonText, on && styles.reasonTextOn]}>{r.label}</Text>
                {on && <Check size={16} color={Colors.primary} strokeWidth={3} />}
              </Pressable>
            );
          })}
          <PrimaryButton label="Decline" onPress={onReject} loading={reject.isPending} disabled={!reasonCode} style={styles.btn} />
        </View>
      </Modal>

      {/* F7 — reschedule sheet */}
      <Modal visible={sheet === 'reschedule'} transparent animationType="slide" onRequestClose={closeSheet}>
        <Pressable style={styles.backdrop} onPress={closeSheet} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Propose reschedule</Text>
            <Pressable onPress={closeSheet} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
          </View>
          <DatePickerField label="Proposed date" value={proposedDate} onChange={setProposedDate} minYear={new Date().getFullYear()} maxYear={new Date().getFullYear() + 1} />
          <TextInputField label="Proposed time" placeholder="e.g. 10:30 AM" value={proposedTime} onChangeText={setProposedTime} />
          <TextInputField label="Note (optional)" placeholder="Add a note for the patient" value={note} onChangeText={setNote} />
          <PrimaryButton label="Send proposal" onPress={onRequestReschedule} loading={requestReschedule.isPending} style={styles.btn} />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  hero:        { alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.lg },
  name:        { ...Typography.titleLg, color: Colors.onSurface, marginTop: Spacing.sm },
  badges:      { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, justifyContent: 'center' },
  card:        { marginBottom: Spacing.md },
  note:        { ...Typography.bodyMd, color: Colors.onSurface },
  actions:     { gap: Spacing.sm },
  btn:         { marginTop: Spacing.sm },
  rejectBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, height: 48, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.errorContainer, marginTop: Spacing.sm },
  rejectText:  { ...Typography.labelMd, color: Colors.error },
  resolved:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow },
  resolvedText:{ ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  backdrop:    { flex: 1, backgroundColor: 'rgba(11,28,48,0.4)' },
  sheet:       { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.sm },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, marginBottom: Spacing.sm },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, marginBottom: Spacing.xs },
  sheetTitle:  { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  reasonRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh },
  reasonRowOn: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  reasonText:  { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  reasonTextOn:{ color: Colors.primary },
});
