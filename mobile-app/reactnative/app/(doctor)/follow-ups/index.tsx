import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CalendarClock, Plus, HeartPulse, Bell, CheckCircle2, XCircle, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import DatePickerField from '@/components/DatePickerField';
import { formatKobo } from '@/api/doctor.phase2.api';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { SectionCard, StateView, StatusBadge, AlertCard } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { useFollowUps, useReviewFollowUpRequest, useFollowUpEligibility, useSetFollowUpReminder, useCompleteFollowUp } from '@/features/doctor/hooks';
import { FOLLOW_UP_STATUS_LABELS } from '@/features/doctor/constants';
import type { FollowUpPlan, FollowUpStatus } from '@/types/doctor.phase2';

const CURRENT_YEAR = new Date().getFullYear();

const STATUS_TONE: Record<FollowUpStatus, StatusTone> = {
  scheduled: 'info',
  requested: 'warning',
  approved:  'brand',
  rejected:  'danger',
  completed: 'success',
  cancelled: 'neutral',
};

export default function FollowUpsScreen() {
  const { data: followUps = [], isLoading, isError, refetch } = useFollowUps();
  const review = useReviewFollowUpRequest();
  // Q4 / Q5 — free-vs-paid eligibility banner (demo patient).
  const { data: eligibility } = useFollowUpEligibility('pat-2');
  const setReminder = useSetFollowUpReminder();
  const complete = useCompleteFollowUp();

  const [reminderFor, setReminderFor] = useState<FollowUpPlan | null>(null);
  const [completeFor, setCompleteFor] = useState<FollowUpPlan | null>(null);

  const handleReview = (plan: FollowUpPlan, decision: 'approve' | 'reject') => {
    Alert.alert(
      decision === 'approve' ? 'Approve request?' : 'Reject request?',
      `${plan.reason} for ${plan.patient.name}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: decision === 'approve' ? 'Approve' : 'Reject',
          style: decision === 'reject' ? 'destructive' : 'default',
          onPress: async () => {
            try {
              await review.mutateAsync({ followUpId: plan.id, decision });
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
      <TeleHeader
        title="Follow-ups"
        right={
          <Pressable onPress={() => router.push('/(doctor)/follow-ups/new')} style={styles.addBtn} accessibilityRole="button" accessibilityLabel="New follow-up">
            <Plus size={20} color={Colors.primary} strokeWidth={2.2} />
          </Pressable>
        }
      />

      {isLoading && followUps.length === 0 ? (
        <StateView variant="loading" label="Loading follow-ups" />
      ) : isError ? (
        <StateView variant="error" message="We could not load follow-ups." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {/* Q4 / Q5 — eligibility banner */}
          {eligibility && (
            <AlertCard
              icon={CalendarClock}
              tone={eligibility.freeEligible ? 'info' : 'warning'}
              title={eligibility.freeEligible ? 'Free follow-up available' : 'Paid follow-up required'}
              body={`${eligibility.reason} (${eligibility.daysSinceConsult}/${eligibility.windowDays} days since consult${eligibility.freeEligible ? '' : ` · ${formatKobo(eligibility.paidFeeKobo)}`}).`}
            />
          )}

          {/* Q13 — long-term care plans entry point */}
          <Pressable style={styles.link} onPress={() => router.push('/(doctor)/care-plans')} accessibilityRole="button" accessibilityLabel="Long-term care plans">
            <HeartPulse size={18} color={Colors.teal} strokeWidth={2} />
            <Text style={styles.linkText}>Long-term care plans</Text>
          </Pressable>

          {followUps.length === 0 ? (
            <StateView variant="empty" icon={CalendarClock} title="No follow-ups" message="Follow-up plans and patient requests will appear here." />
          ) : (
            followUps.map((f) => {
              const canClose = f.status === 'approved' || f.status === 'scheduled';
              return (
                <SectionCard key={f.id} style={styles.card}>
                  <View style={styles.header}>
                    <DoctorAvatar initials={f.patient.initials} color={f.patient.avatarColor} size={44} />
                    <View style={styles.headerBody}>
                      <Text style={styles.name} numberOfLines={1}>{f.patient.name}</Text>
                      <Text style={styles.ref} numberOfLines={1}>{f.ref} · {f.isPatientRequest ? 'Patient request' : 'Doctor plan'}</Text>
                    </View>
                    <StatusBadge label={FOLLOW_UP_STATUS_LABELS[f.status]} tone={STATUS_TONE[f.status]} />
                  </View>

                  <Text style={styles.reason} numberOfLines={3}>{f.reason}</Text>
                  <View style={styles.metaRow}>
                    <Text style={styles.meta}>Due {new Date(`${f.dueDate}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                    <Text style={styles.fee}>{f.kind === 'free' ? 'Free' : formatKobo(f.feeKobo)}</Text>
                  </View>
                  {f.status === 'rejected' && !!f.rejectionReason && (
                    <Text style={styles.rejection}>Rejected: {f.rejectionReason}</Text>
                  )}

                  {/* Q7 / Q8 — approve / reject */}
                  {f.status === 'requested' && (
                    <View style={styles.actions}>
                      <PrimaryButton label="Approve" onPress={() => handleReview(f, 'approve')} loading={review.isPending} style={styles.btn} />
                      <PrimaryButton label="Reject" onPress={() => handleReview(f, 'reject')} variant="secondary" disabled={review.isPending} style={styles.btn} />
                    </View>
                  )}

                  {/* Q9 reminder + Q10/Q11/Q12 complete/missed */}
                  {canClose && (
                    <View style={styles.iconActions}>
                      <Pressable style={styles.iconBtn} onPress={() => setReminderFor(f)} accessibilityRole="button" accessibilityLabel="Set reminder">
                        <Bell size={16} color={Colors.secondary} strokeWidth={2} />
                        <Text style={styles.iconBtnText}>Reminder</Text>
                      </Pressable>
                      <Pressable style={styles.iconBtn} onPress={() => setCompleteFor(f)} accessibilityRole="button" accessibilityLabel="Complete follow-up">
                        <CheckCircle2 size={16} color={Colors.teal} strokeWidth={2} />
                        <Text style={styles.iconBtnText}>Complete</Text>
                      </Pressable>
                      <Pressable
                        style={styles.iconBtn}
                        onPress={() => {
                          Alert.alert('Mark as missed?', `${f.patient.name} did not attend the follow-up.`, [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Mark missed', style: 'destructive', onPress: async () => {
                              try { await complete.mutateAsync({ followUpId: f.id, missed: true }); }
                              catch { Alert.alert('Failed', 'Please try again.'); }
                            } },
                          ]);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Mark missed"
                      >
                        <XCircle size={16} color={Colors.error} strokeWidth={2} />
                        <Text style={styles.iconBtnText}>Missed</Text>
                      </Pressable>
                    </View>
                  )}
                </SectionCard>
              );
            })
          )}
        </ScrollView>
      )}

      {/* Q9 — reminder sheet */}
      <Modal visible={!!reminderFor} transparent animationType="slide" onRequestClose={() => setReminderFor(null)}>
        <Pressable style={styles.backdrop} onPress={() => setReminderFor(null)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Set reminder</Text>
            <Pressable onPress={() => setReminderFor(null)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
          </View>
          {reminderFor && (
            <ReminderPicker
              pending={setReminder.isPending}
              onConfirm={async (remindAt) => {
                try {
                  await setReminder.mutateAsync({ followUpId: reminderFor.id, remindAt });
                  setReminderFor(null);
                  Alert.alert('Reminder set', 'A reminder has been scheduled.');
                } catch {
                  Alert.alert('Failed', 'Please try again.');
                }
              }}
            />
          )}
        </View>
      </Modal>

      {/* Q10 / Q11 — complete with outcome note */}
      <Modal visible={!!completeFor} transparent animationType="slide" onRequestClose={() => setCompleteFor(null)}>
        <Pressable style={styles.backdrop} onPress={() => setCompleteFor(null)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Complete follow-up</Text>
            <Pressable onPress={() => setCompleteFor(null)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
          </View>
          {completeFor && (
            <CompletePicker
              pending={complete.isPending}
              onConfirm={async (outcomeNote) => {
                try {
                  await complete.mutateAsync({ followUpId: completeFor.id, outcomeNote: outcomeNote.trim() || undefined });
                  setCompleteFor(null);
                  Alert.alert('Marked complete', 'The follow-up has been completed.');
                } catch {
                  Alert.alert('Failed', 'Please try again.');
                }
              }}
            />
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ReminderPicker({ pending, onConfirm }: { pending: boolean; onConfirm: (remindAt: string) => void }) {
  const [date, setDate] = useState('');
  return (
    <>
      <DatePickerField label="Remind on" value={date} onChange={setDate} minYear={CURRENT_YEAR} maxYear={CURRENT_YEAR + 2} />
      <PrimaryButton label="Set reminder" onPress={() => onConfirm(`${date}T09:00:00`)} loading={pending} disabled={!date} style={styles.btn} />
    </>
  );
}

function CompletePicker({ pending, onConfirm }: { pending: boolean; onConfirm: (note: string) => void }) {
  const [note, setNote] = useState('');
  return (
    <>
      <TextInputField label="Outcome note (optional)" value={note} onChangeText={setNote} placeholder="e.g. BP controlled, continue current dose" multiline />
      <PrimaryButton label="Mark complete" onPress={() => onConfirm(note)} loading={pending} style={styles.btn} />
    </>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  addBtn:      { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24, gap: Spacing.md, flexGrow: 1 },
  link:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, height: 52, paddingHorizontal: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  linkText:    { ...Typography.labelMd, color: Colors.onSurface },
  card:        {},
  header:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  headerBody:  { flex: 1, gap: 2 },
  name:        { ...Typography.titleMd, color: Colors.onSurface },
  ref:         { ...Typography.caption, color: Colors.onSurfaceVariant },
  reason:      { ...Typography.bodyMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  metaRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  meta:        { ...Typography.caption, color: Colors.onSurfaceVariant },
  fee:         { ...Typography.labelMd, color: Colors.primary },
  rejection:   { ...Typography.bodySm, color: Colors.error, marginTop: Spacing.xs },
  actions:     { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  iconActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  iconBtn:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, height: 40, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  iconBtnText: { ...Typography.labelSm, color: Colors.onSurface, fontWeight: '600' },
  btn:         { flex: 1, marginTop: Spacing.sm },
  backdrop:    { flex: 1, backgroundColor: 'rgba(11,28,48,0.4)' },
  sheet:       { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.sm },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, marginBottom: Spacing.sm },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, marginBottom: Spacing.xs },
  sheetTitle:  { ...Typography.titleMd, color: Colors.onSurface },
});
