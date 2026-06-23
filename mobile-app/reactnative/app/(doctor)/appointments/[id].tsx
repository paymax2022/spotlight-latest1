import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Modal, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { X, Video, Phone, MessageCircle, UserX } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import TextInputField from '@/components/TextInputField';
import DatePickerField from '@/components/DatePickerField';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { SectionCard, StateView, InfoRow, StatusBadge, CountdownBanner } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { useAppointment, useStartConsultation, useEndConsultation, useMarkNoShow, useCancelAppointment, useRescheduleAppointment } from '@/features/doctor/hooks';
import { APPOINTMENT_BILLING_LABELS, CONSULT_SOON_WINDOW_MINS, CONSULT_LATE_GRACE_MINS } from '@/features/doctor/constants';
import { formatKobo, computeConsultCountdown } from '@/api/doctor.batch1.api';
import type { AppointmentBilling, ConsultType } from '@/types/doctor.batch1';

const TYPE_ICON: Record<ConsultType, LucideIcon> = { video: Video, audio: Phone, chat: MessageCircle };
const BILLING_TONE: Record<AppointmentBilling, StatusTone> = { hmo: 'brand', paid: 'success', free_follow_up: 'info' };

// Build a parseable ISO-ish slot timestamp from "2026-06-20" + "09:00 AM".
function slotToIso(date: string, time: string): string {
  const m = time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return `${date}T09:00:00`;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const mer = m[3]?.toUpperCase();
  if (mer === 'PM' && h < 12) h += 12;
  if (mer === 'AM' && h === 12) h = 0;
  return `${date}T${String(h).padStart(2, '0')}:${min}:00`;
}

export default function AppointmentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: appt, isLoading, isError, refetch } = useAppointment(id);

  const start = useStartConsultation();
  const end = useEndConsultation();
  const noShow = useMarkNoShow();
  const cancel = useCancelAppointment();
  const reschedule = useRescheduleAppointment();

  const [sheet, setSheet] = useState<null | 'cancel' | 'reschedule'>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [newDate, setNewDate] = useState<string | undefined>();
  const [newTime, setNewTime] = useState('');

  const closeSheet = () => { setSheet(null); setCancelReason(''); setNewDate(undefined); setNewTime(''); };

  const onStart = async () => {
    if (!appt) return;
    try { await start.mutateAsync({ appointmentId: appt.id }); Alert.alert('Started', 'Consultation started.'); } catch { Alert.alert('Failed', 'Could not start the consultation.'); }
  };
  const onEnd = async () => {
    if (!appt) return;
    try { await end.mutateAsync({ appointmentId: appt.id }); Alert.alert('Ended', 'Consultation marked complete.'); } catch { Alert.alert('Failed', 'Could not end the consultation.'); }
  };
  const onNoShow = async () => {
    if (!appt) return;
    try { await noShow.mutateAsync({ appointmentId: appt.id }); Alert.alert('Marked', 'Marked as no-show.'); } catch { Alert.alert('Failed', 'Could not mark no-show.'); }
  };
  const onCancel = async () => {
    if (!appt) return;
    try { await cancel.mutateAsync({ appointmentId: appt.id, reason: cancelReason || undefined }); closeSheet(); Alert.alert('Cancelled', 'Appointment cancelled.'); } catch { Alert.alert('Failed', 'Could not cancel.'); }
  };
  const onReschedule = async () => {
    if (!appt || !newDate || !newTime.trim()) { Alert.alert('Incomplete', 'Choose a date and time.'); return; }
    try { await reschedule.mutateAsync({ appointmentId: appt.id, newSlotDate: newDate, newSlotTime: newTime.trim() }); closeSheet(); Alert.alert('Rescheduled', 'Appointment rescheduled.'); } catch { Alert.alert('Failed', 'Could not reschedule.'); }
  };

  if (isLoading && !appt) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Appointment" />
        <StateView variant="loading" label="Loading appointment" />
      </SafeAreaView>
    );
  }

  if (isError || !appt) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Appointment" />
        <StateView variant="error" message="We could not load this appointment." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  // Consolidated billing variant (F11/F12/F13) derived from the appointment.
  const billing: AppointmentBilling = appt.isHmo ? 'hmo' : appt.feeKobo === 0 ? 'free_follow_up' : 'paid';
  const TypeIcon = TYPE_ICON[appt.consultType];
  const countdown = computeConsultCountdown(appt.id, slotToIso(appt.slotDate, appt.slotTime), CONSULT_SOON_WINDOW_MINS, CONSULT_LATE_GRACE_MINS);
  const isLive = appt.status === 'in_progress';
  const isActive = appt.status === 'upcoming' || appt.status === 'confirmed';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Appointment" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <DoctorAvatar initials={appt.patient.initials} color={appt.patient.avatarColor} size={64} />
          <Text style={styles.name}>{appt.patient.name}</Text>
          <View style={styles.heroMeta}>
            <TypeIcon size={14} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.heroMetaText}>{appt.slotTime} · {new Date(`${appt.slotDate}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'long' })}</Text>
          </View>
          <StatusBadge label={APPOINTMENT_BILLING_LABELS[billing]} tone={BILLING_TONE[billing]} />
        </View>

        {(isActive || isLive) && (
          <View style={styles.blockGap}>
            <CountdownBanner countdown={countdown} />
          </View>
        )}

        <SectionCard title="Details" style={styles.card}>
          <InfoRow label="Reference" value={appt.ref} />
          <InfoRow label="Type" value={appt.consultType} />
          <InfoRow label="Status" value={appt.status} />
          <InfoRow label="Fee" value={billing === 'free_follow_up' ? 'Free follow-up' : formatKobo(appt.feeKobo)} />
          {!!appt.reason && <InfoRow label="Reason" value={appt.reason} />}
        </SectionCard>

        {/* F11 — HMO-covered billing variant */}
        {billing === 'hmo' && (
          <SectionCard title="HMO coverage" style={styles.card}>
            <InfoRow label="Provider" value={appt.hmoProvider ?? 'HMO'} />
            <InfoRow label="Patient pays" value={formatKobo(0)} />
            <Text style={styles.note}>Settlement is handled via the HMO claim after the consult.</Text>
          </SectionCard>
        )}

        {/* F13 — Free follow-up billing variant */}
        {billing === 'free_follow_up' && (
          <SectionCard title="Free follow-up" style={styles.card}>
            <Text style={styles.note}>This is a complimentary follow-up consultation — no charge to the patient.</Text>
          </SectionCard>
        )}

        {/* Actions — F14/F17/F18 + E9/E10 sheets */}
        <View style={styles.actions}>
          {isActive && <PrimaryButton label="Start consultation" onPress={onStart} loading={start.isPending} style={styles.btn} />}
          {isLive && <PrimaryButton label="End consultation" onPress={onEnd} loading={end.isPending} style={styles.btn} />}
          {(isActive || isLive) && (
            <>
              <PrimaryButton label="Reschedule" onPress={() => setSheet('reschedule')} variant="secondary" style={styles.btn} />
              <View style={styles.actionRow}>
                <Pressable style={styles.minorBtn} onPress={onNoShow} disabled={noShow.isPending} accessibilityRole="button" accessibilityLabel="Mark no-show">
                  <UserX size={16} color={Colors.error} strokeWidth={2} />
                  <Text style={styles.minorText}>No-show</Text>
                </Pressable>
                <Pressable style={styles.minorBtn} onPress={() => setSheet('cancel')} disabled={cancel.isPending} accessibilityRole="button" accessibilityLabel="Cancel appointment">
                  <X size={16} color={Colors.error} strokeWidth={2} />
                  <Text style={styles.minorText}>Cancel</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </ScrollView>

      {/* E10 — cancel sheet */}
      <Modal visible={sheet === 'cancel'} transparent animationType="slide" onRequestClose={closeSheet}>
        <Pressable style={styles.backdrop} onPress={closeSheet} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Cancel appointment</Text>
            <Pressable onPress={closeSheet} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
          </View>
          <TextInputField label="Reason (optional)" placeholder="Let the patient know why" value={cancelReason} onChangeText={setCancelReason} multiline />
          <PrimaryButton label="Confirm cancellation" onPress={onCancel} loading={cancel.isPending} style={styles.btn} />
        </View>
      </Modal>

      {/* E9 — reschedule sheet */}
      <Modal visible={sheet === 'reschedule'} transparent animationType="slide" onRequestClose={closeSheet}>
        <Pressable style={styles.backdrop} onPress={closeSheet} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Reschedule</Text>
            <Pressable onPress={closeSheet} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
          </View>
          <DatePickerField label="New date" value={newDate} onChange={setNewDate} minYear={new Date().getFullYear()} maxYear={new Date().getFullYear() + 1} />
          <TextInputField label="New time" placeholder="e.g. 10:30 AM" value={newTime} onChangeText={setNewTime} />
          <PrimaryButton label="Confirm reschedule" onPress={onReschedule} loading={reschedule.isPending} style={styles.btn} />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  hero:        { alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.lg },
  name:        { ...Typography.titleLg, color: Colors.onSurface, marginTop: Spacing.sm },
  heroMeta:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  heroMetaText:{ ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  blockGap:    { marginBottom: Spacing.md },
  card:        { marginBottom: Spacing.md },
  note:        { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  actions:     { gap: Spacing.sm },
  btn:         { marginTop: Spacing.sm },
  actionRow:   { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  minorBtn:    { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, height: 48, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.errorContainer },
  minorText:   { ...Typography.labelMd, color: Colors.error },
  backdrop:    { flex: 1, backgroundColor: 'rgba(11,28,48,0.4)' },
  sheet:       { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.sm },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, marginBottom: Spacing.sm },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, marginBottom: Spacing.xs },
  sheetTitle:  { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
});
