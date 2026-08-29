import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Modal, Pressable, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import {
  Video, Phone, MessageCircle, FileText, X, CalendarClock, NotebookPen,
} from 'lucide-react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { getAppointment, cancelAppointment, formatKobo, DEMO_APPOINTMENTS } from '@/api/telemedicine.api';
import { getErrorMessage } from '@/utils/errorMapper';
import { TeleHeader, DoctorAvatar, ConsultStatusBadge } from '@/features/telemedicine/components';
import { IntakeStatusBadge } from '@/features/health/components';
import { useApptIntake } from '@/features/health/hooks';
import type { ConsultType } from '@/types/telemedicine';
import PrimaryButton from '@/components/PrimaryButton';
import { ClipboardList, ChevronRight } from 'lucide-react-native';

const TYPE_META: Record<ConsultType, { label: string; Icon: typeof Video }> = {
  video: { label: 'Video', Icon: Video },
  audio: { label: 'Audio', Icon: Phone },
  chat:  { label: 'Chat',  Icon: MessageCircle },
};

export default function AppointmentDetailScreen() {
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [sheet, setSheet] = useState<null | 'cancel' | 'reschedule'>(null);

  const { data: appt, isLoading } = useQuery({
    queryKey: ['tele-appointment', id],
    queryFn:  () => getAppointment(String(id)),
    placeholderData: DEMO_APPOINTMENTS.find((a) => a.id === id),
  });

  // Pre-Consult intake gate (M1 status card + consult guard).
  const intakeQ = useApptIntake(String(id));
  const intakeStatus = intakeQ.data?.intake.status;
  const intakeReady = intakeStatus === 'SUBMITTED';
  const goIntake = () => {
    const base = `/services/telemedicine/appointment/${id}/intake`;
    if (intakeStatus === 'SUBMITTED') router.push(base as never); // M16 edit
    else if (intakeStatus === 'DRAFT') router.push(`${base}?resume=1` as never); // M3 resume
    else router.push(`${base}/consent` as never); // M2 consent first
  };

  const { mutate: doCancel, isPending: cancelling, error: cancelErr } = useMutation({
    mutationFn: () => cancelAppointment(String(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tele-appointments'] });
      qc.invalidateQueries({ queryKey: ['tele-appointment', id] });
      setSheet(null);
      goBack('/services/telemedicine');
    },
  });

  if (isLoading && !appt) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Appointment" />
        <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
      </SafeAreaView>
    );
  }
  if (!appt) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Appointment" />
        <Text style={styles.empty}>Appointment not found.</Text>
      </SafeAreaView>
    );
  }

  const TypeIcon = TYPE_META[appt.consultType].Icon;
  const dateLabel = new Date(`${appt.slotDate}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const isUpcoming = ['upcoming', 'confirmed', 'in_progress'].includes(appt.status);
  // What the patient actually paid = what was escrowed, and what a cancellation
  // refunds. Bookings made before ADR-040 have no platform fee, so their total is
  // the consultation fee alone.
  const paidKobo = appt.totalKobo ?? appt.feeKobo + (appt.platformFeeKobo ?? 0);
  const isCompleted = appt.status === 'completed';
  // Consult is unreachable until intake is SUBMITTED (PRD §1 structural gate).
  const canJoin = ['confirmed', 'in_progress'].includes(appt.status) && intakeReady;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Appointment" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={[styles.headCard, shadow1]}>
          <DoctorAvatar initials={appt.doctor.initials} color={appt.doctor.avatarColor} size={64} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.docName}>{appt.doctor.name}</Text>
            <Text style={styles.docSpec}>{appt.doctor.specialties.join(' • ')}</Text>
            <ConsultStatusBadge status={appt.status} />
          </View>
        </View>

        <View style={[styles.card, shadow1]}>
          <Row label="Reference" value={appt.ref} />
          <Row label="Date" value={dateLabel} />
          <Row label="Time" value={appt.slotTime} />
          <View style={styles.typeRow}>
            <Text style={styles.rowLabel}>Type</Text>
            <View style={styles.typeBadge}>
              <TypeIcon size={14} color={Colors.secondary} strokeWidth={2} />
              <Text style={styles.typeText}>{TYPE_META[appt.consultType].label}</Text>
            </View>
          </View>
          {/* Consultation fee and platform fee are separate legs (ADR-040). Showing
              only the consultation fee here misreported what a card payer was
              actually charged. */}
          <Row label="Consultation fee" value={formatKobo(appt.feeKobo)} />
          {(appt.platformFeeKobo ?? 0) > 0 ? (
            <Row label="Platform fee" value={formatKobo(appt.platformFeeKobo ?? 0)} />
          ) : null}
          <Row label="Total paid" value={formatKobo(paidKobo)} last />
        </View>

        {/* M1 — Pre-Consult intake status card */}
        {isUpcoming ? (
          <Pressable style={[styles.card, shadow1]} onPress={goIntake}>
            <View style={styles.intakeHead}>
              <View style={styles.intakeHeadLeft}>
                <ClipboardList size={16} color={Colors.primary} strokeWidth={2} />
                <Text style={styles.noteTitle}>Health intake</Text>
              </View>
              <IntakeStatusBadge status={intakeStatus} />
            </View>
            <View style={styles.intakeBody}>
              <Text style={[styles.noteText, { flex: 1, paddingBottom: 0 }]}>
                {intakeReady
                  ? 'Your details are ready for your doctor. Tap to review or update them before the consult.'
                  : intakeStatus === 'DRAFT'
                    ? 'Pick up where you left off — your progress is saved.'
                    : 'Add your health details so your doctor walks in informed.'}
              </Text>
              <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </View>
          </Pressable>
        ) : null}

        {appt.reason ? (
          <View style={[styles.card, shadow1]}>
            <View style={styles.noteHead}>
              <NotebookPen size={16} color={Colors.primary} strokeWidth={2} />
              <Text style={styles.noteTitle}>Reason for visit</Text>
            </View>
            <Text style={styles.noteText}>{appt.reason}</Text>
          </View>
        ) : null}

        {appt.doctorNote ? (
          <View style={[styles.card, shadow1]}>
            <View style={styles.noteHead}>
              <FileText size={16} color={Colors.teal} strokeWidth={2} />
              <Text style={styles.noteTitle}>Doctor's note</Text>
            </View>
            <Text style={styles.noteText}>{appt.doctorNote}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {isUpcoming && (
          <>
            {!intakeReady ? (
              <PrimaryButton
                label={intakeStatus === 'DRAFT' ? 'Finish health intake' : 'Add your health details'}
                onPress={goIntake}
              />
            ) : null}
            <PrimaryButton
              label={
                !intakeReady
                  ? 'Complete intake to join'
                  : canJoin
                    ? 'Join consultation'
                    : 'Awaiting doctor confirmation'
              }
              onPress={() => router.push(`/services/telemedicine/consult/${appt.id}`)}
              disabled={!canJoin}
              variant={!intakeReady ? 'secondary' : 'primary'}
            />
            <View style={styles.footerRow}>
              <PrimaryButton label="Reschedule" variant="secondary" fullWidth={false} style={{ flex: 1 }} onPress={() => setSheet('reschedule')} />
              <PrimaryButton label="Cancel" variant="ghost" fullWidth={false} style={{ flex: 1 }} onPress={() => setSheet('cancel')} />
            </View>
          </>
        )}
        {isCompleted && (
          <View style={styles.footerRow}>
            <PrimaryButton label="View summary" variant="secondary" fullWidth={false} style={{ flex: 1 }} onPress={() => router.push(`/services/telemedicine/appointment/${appt.id}/summary`)} />
            <PrimaryButton label="Rate visit" fullWidth={false} style={{ flex: 1 }} onPress={() => router.push(`/services/telemedicine/appointment/${appt.id}/review`)} />
          </View>
        )}
      </View>

      {/* ── Cancel / Reschedule sheet (T12) ─────────────────────── */}
      <Modal visible={sheet !== null} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{sheet === 'cancel' ? 'Cancel appointment' : 'Reschedule appointment'}</Text>
              <Pressable onPress={() => setSheet(null)}><X size={22} color={Colors.onSurface} /></Pressable>
            </View>

            {sheet === 'cancel' ? (
              <>
                <View style={styles.policyCard}>
                  <Text style={styles.policyTitle}>Refund preview</Text>
                  {/* Cancellation refunds the whole escrowed total, platform fee
                      included — quoting the consultation fee alone under-promised
                      the refund a card payer was owed. */}
                  <Row label="Total paid" value={formatKobo(paidKobo)} />
                  <Row label="Cancellation penalty" value={formatKobo(0)} />
                  <Row label="Refund to wallet" value={formatKobo(paidKobo)} highlight last />
                  <Text style={styles.policyNote}>Free cancellation up to 1 hour before your appointment. Refunds post to your wallet instantly.</Text>
                </View>
                {cancelErr ? <Text style={styles.errorText}>{getErrorMessage(cancelErr)}</Text> : null}
                <PrimaryButton label="Confirm cancellation" onPress={() => doCancel()} loading={cancelling} />
                <PrimaryButton label="Keep appointment" variant="ghost" onPress={() => setSheet(null)} />
              </>
            ) : (
              <>
                <View style={styles.policyCard}>
                  <View style={styles.noteHead}>
                    <CalendarClock size={16} color={Colors.secondary} strokeWidth={2} />
                    <Text style={styles.policyTitle}>Pick a new time</Text>
                  </View>
                  <Text style={styles.policyNote}>Choose another available slot with {appt.doctor.name}. Your fee carries over — no extra charge.</Text>
                </View>
                <PrimaryButton
                  label="Choose new slot"
                  onPress={() => { setSheet(null); router.push(`/services/telemedicine/doctor/${appt.doctor.id}/book`); }}
                />
                <PrimaryButton label="Not now" variant="ghost" onPress={() => setSheet(null)} />
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Row({ label, value, highlight, last }: { label: string; value: string; highlight?: boolean; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, highlight && { color: Colors.primary, fontWeight: '800' }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.lg, paddingBottom: 160, gap: Spacing.md },
  headCard:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  docName:     { ...Typography.titleLg, color: Colors.onSurface },
  docSpec:     { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: 4 },
  card:        { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, paddingHorizontal: Spacing.cardPadding, paddingVertical: 4, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  row:         { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing.md, gap: Spacing.md },
  rowBorder:   { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  rowLabel:    { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rowValue:    { ...Typography.labelMd, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
  typeRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  typeBadge:   { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 28, borderRadius: Radius.full, backgroundColor: Colors.iconBgBlue },
  typeText:    { ...Typography.labelSm, color: Colors.secondary },
  noteHead:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.md, marginBottom: Spacing.sm },
  intakeHead:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: Spacing.md, marginBottom: Spacing.sm },
  intakeHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  intakeBody:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingBottom: Spacing.md },
  noteTitle:   { ...Typography.titleMd, color: Colors.onSurface },
  noteText:    { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22, paddingBottom: Spacing.md },
  footer:      { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 32 : Spacing.md, gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  footerRow:   { flexDirection: 'row', gap: Spacing.sm },
  empty:       { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.xl },
  overlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet:       { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.cardPadding, paddingBottom: Platform.OS === 'ios' ? 40 : Spacing.xl, gap: Spacing.sm },
  handle:      { width: 40, height: 4, borderRadius: Radius.full, backgroundColor: Colors.outlineVariant, alignSelf: 'center', marginBottom: Spacing.md },
  sheetHead:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
  sheetTitle:  { ...Typography.titleLg, color: Colors.onSurface },
  policyCard:  { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, marginBottom: Spacing.md },
  policyTitle: { ...Typography.titleMd, color: Colors.onSurface, paddingVertical: Spacing.sm },
  policyNote:  { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20, paddingVertical: Spacing.sm },
  errorText:   { ...Typography.labelSm, color: Colors.error, marginBottom: Spacing.sm },
});
