import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { ClipboardList, ShieldCheck, CheckCircle2 } from 'lucide-react-native';
import { getDoctor, getDoctorAvailability, DEMO_DOCTORS } from '@/api/telemedicine.api';
import { TeleHeader, SlotPicker, ConsultTypePicker } from '@/features/telemedicine/components';
import type { ConsultType, Slot } from '@/types/telemedicine';
import PrimaryButton from '@/components/PrimaryButton';

// What the post-booking health intake covers (PRD M4–M12) — shown so the patient
// knows the triage step is coming and that the doctor reviews it before the consult.
const INTAKE_COVERS = ['Symptoms & severity', 'Allergies', 'Medications', 'Conditions', 'Vitals (optional)'];

export default function BookSlotScreen() {
  const { id, reason: reasonParam, intakeReady } = useLocalSearchParams<{ id: string; reason?: string; intakeReady?: string }>();
  const [consultType, setConsultType] = useState<ConsultType>('video');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  // When the pre-consultation triage ran first, the chief complaint pre-fills here.
  const [reason, setReason] = useState(typeof reasonParam === 'string' ? reasonParam : '');
  const intakeDone = intakeReady === '1';

  const { data: doctor } = useQuery({
    queryKey: ['tele-doctor', id],
    queryFn:  () => getDoctor(String(id)),
    placeholderData: DEMO_DOCTORS.find((d) => d.id === id),
  });

  const { data: slots = [], isLoading } = useQuery({
    queryKey: ['tele-availability', id],
    queryFn:  () => getDoctorAvailability(String(id)),
  });

  const canContinue = !!selectedSlot && reason.trim().length > 0;

  const onContinue = () => {
    if (!selectedSlot || !doctor) return;
    router.push({
      pathname: '/services/telemedicine/book/confirm',
      params: {
        doctorId: doctor.id,
        slotId: selectedSlot.id,
        slotDate: selectedSlot.date,
        slotTime: selectedSlot.time,
        consultType,
        reason: reason.trim(),
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Book Appointment" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {doctor && (
          <View style={styles.docRow}>
            <Text style={styles.docName}>{doctor.name}</Text>
            <Text style={styles.docSpec}>{doctor.specialties.join(' • ')}</Text>
          </View>
        )}

        <Text style={styles.label}>Consultation type</Text>
        <ConsultTypePicker selected={consultType} onSelect={setConsultType} />

        <Text style={[styles.label, { marginTop: Spacing.lg }]}>Choose a time</Text>
        {isLoading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.md }} />
        ) : (
          <SlotPicker
            slots={slots}
            selectedDate={selectedDate}
            selectedSlot={selectedSlot}
            onSelectDate={(d) => { setSelectedDate(d); setSelectedSlot(null); }}
            onSelectSlot={setSelectedSlot}
          />
        )}

        <Text style={[styles.label, { marginTop: Spacing.lg }]}>Reason for visit</Text>
        <TextInput
          style={styles.reasonInput}
          placeholder="Briefly describe your symptoms or concern"
          placeholderTextColor={Colors.outline}
          value={reason}
          onChangeText={setReason}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />
        <Text style={styles.hint}>This starts your health intake and is shared securely with your doctor before the consultation.</Text>

        {/* Pre-consultation health intake (M1–M17). When the triage ran first
            (from the doctor profile) we confirm it's done; otherwise we explain
            it follows. Either way the doctor reviews it before the consult. */}
        {intakeDone ? (
          <View style={[styles.intakeCard, styles.intakeDoneCard]}>
            <View style={styles.intakeHead}>
              <View style={[styles.intakeIcon, styles.intakeIconDone]}>
                <CheckCircle2 size={18} color={Colors.tertiaryContainer} strokeWidth={2} />
              </View>
              <Text style={styles.intakeTitle}>Pre-visit health check complete</Text>
            </View>
            <Text style={styles.intakeBody}>
              Thanks — your health details are saved and will be shared with your doctor before the
              consultation. You can update them any time before the consult starts.
            </Text>
            <View style={styles.intakeSecure}>
              <ShieldCheck size={14} color={Colors.teal} strokeWidth={2.2} />
              <Text style={styles.intakeSecureText}>
                Visible only to your assigned doctor. Every access is logged. Patient-reported — not a diagnosis.
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.intakeCard}>
            <View style={styles.intakeHead}>
              <View style={styles.intakeIcon}>
                <ClipboardList size={18} color={Colors.primary} strokeWidth={2} />
              </View>
              <Text style={styles.intakeTitle}>Pre-consultation health intake</Text>
            </View>
            <Text style={styles.intakeBody}>
              You’ll complete a short, secure health intake for this booking. Your doctor reviews it before
              your consultation so they walk in informed — it’s required before the consultation can start.
            </Text>
            <View style={styles.chipRow}>
              {INTAKE_COVERS.map((c) => (
                <View key={c} style={styles.chip}><Text style={styles.chipText}>{c}</Text></View>
              ))}
            </View>
            <View style={styles.intakeSecure}>
              <ShieldCheck size={14} color={Colors.teal} strokeWidth={2.2} />
              <Text style={styles.intakeSecureText}>
                Visible only to your assigned doctor. Every access is logged. Patient-reported — not a diagnosis.
              </Text>
            </View>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Continue to payment" onPress={onContinue} disabled={!canContinue} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.lg, paddingBottom: 120 },
  docRow:      { marginBottom: Spacing.lg },
  docName:     { ...Typography.titleLg, color: Colors.onSurface },
  docSpec:     { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  label:       { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.md },
  reasonInput: { minHeight: 110, borderWidth: 1.5, borderColor: Colors.outlineVariant, borderRadius: Radius.lg, padding: Spacing.md, ...Typography.bodyMd, color: Colors.onSurface, backgroundColor: Colors.surfaceContainerLow },
  hint:        { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  intakeCard:  { marginTop: Spacing.lg, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, gap: Spacing.sm },
  intakeDoneCard: { backgroundColor: Colors.iconBgTeal, borderColor: Colors.tertiaryContainer },
  intakeHead:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  intakeIcon:  { width: 32, height: 32, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  intakeIconDone: { backgroundColor: Colors.surfaceContainerLowest },
  intakeTitle: { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  intakeBody:  { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
  chipRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip:        { paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.full, backgroundColor: Colors.iconBgBlue },
  chipText:    { ...Typography.labelSm, color: Colors.secondary },
  intakeSecure:{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 2 },
  intakeSecureText: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 16 },
  footer:      { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 32 : Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
