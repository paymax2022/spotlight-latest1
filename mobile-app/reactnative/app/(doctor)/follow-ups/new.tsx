import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, KeyboardAvoidingView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CalendarClock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import DatePickerField from '@/components/DatePickerField';
import { formatKobo } from '@/api/doctor.phase2.api';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, SoapSection, AlertCard } from '@/features/doctor/components';
import { useCreateFollowUp, useFollowUpEligibility } from '@/features/doctor/hooks';
import { FOLLOW_UP_KIND_OPTIONS } from '@/features/doctor/constants';
import type { FollowUpKind } from '@/types/doctor.phase2';

const CURRENT_YEAR = new Date().getFullYear();

export default function NewFollowUpScreen() {
  const { patientId, patientName, appointmentId } = useLocalSearchParams<{ patientId?: string; patientName?: string; appointmentId?: string }>();

  const create = useCreateFollowUp();
  // Q4 / Q5 — free-vs-paid eligibility for the selected patient.
  const { data: eligibility } = useFollowUpEligibility(patientId ? String(patientId) : '', appointmentId ? String(appointmentId) : undefined);

  const [reason, setReason] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [kind, setKind] = useState<FollowUpKind>('free');
  const [feeNaira, setFeeNaira] = useState('');

  const feeKobo = kind === 'paid' ? Math.round((Number(feeNaira) || 0) * 100) : 0;
  const canSubmit = !!patientId && reason.trim().length > 0 && !!dueDate && (kind === 'free' || feeKobo > 0);

  const handleSubmit = async () => {
    if (!patientId) {
      Alert.alert('No patient', 'Open a follow-up from a patient record to select the patient.');
      return;
    }
    if (!canSubmit) {
      Alert.alert('Incomplete', 'Add a reason, due date and (for paid plans) a fee.');
      return;
    }
    try {
      const result = await create.mutateAsync({
        patientId: String(patientId),
        appointmentId: appointmentId ? String(appointmentId) : undefined,
        reason: reason.trim(),
        dueDate,
        kind,
        feeKobo,
      });
      Alert.alert('Follow-up created', `${result.ref} has been scheduled.`, [
        { text: 'Done', onPress: () => router.replace('/(doctor)/follow-ups') },
      ]);
    } catch {
      Alert.alert('Failed', 'Could not create the follow-up. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="New Follow-up" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {!!patientName && <Text style={styles.patientLine}>For {patientName}</Text>}

          {eligibility && (
            <View style={styles.eligibilityWrap}>
              <AlertCard
                icon={CalendarClock}
                tone={eligibility.freeEligible ? 'info' : 'warning'}
                title={eligibility.freeEligible ? 'Free follow-up available' : 'Paid follow-up required'}
                body={`${eligibility.reason} (${eligibility.daysSinceConsult}/${eligibility.windowDays} days${eligibility.freeEligible ? '' : ` · ${formatKobo(eligibility.paidFeeKobo)}`}).`}
              />
            </View>
          )}

          <SoapSection label="Reason" hint="Why is a follow-up needed?" value={reason} onChangeText={setReason} placeholder="e.g. Review blood pressure after medication change" />

          <DatePickerField
            label="Due date"
            value={dueDate}
            onChange={setDueDate}
            minYear={CURRENT_YEAR}
            maxYear={CURRENT_YEAR + 2}
          />

          <SectionCard title="Type" style={styles.card}>
            <View style={styles.kindRow}>
              {FOLLOW_UP_KIND_OPTIONS.map((o) => {
                const active = kind === o.value;
                return (
                  <Pressable
                    key={o.value}
                    onPress={() => setKind(o.value)}
                    style={[styles.kindChip, active && styles.kindChipOn]}
                    accessibilityRole="button"
                    accessibilityLabel={o.label}
                  >
                    <Text style={[styles.kindText, active && styles.kindTextOn]}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </SectionCard>

          {kind === 'paid' && (
            <TextInputField
              label="Follow-up fee (NGN)"
              value={feeNaira}
              onChangeText={setFeeNaira}
              keyboardType="number-pad"
              placeholder="e.g. 5000"
            />
          )}

          <PrimaryButton label="Create follow-up" onPress={handleSubmit} loading={create.isPending} disabled={!canSubmit} style={styles.btn} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  flex:        { flex: 1 },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  patientLine: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  eligibilityWrap: { marginBottom: Spacing.md },
  card:        { marginBottom: Spacing.md },
  kindRow:     { flexDirection: 'row', gap: Spacing.sm },
  kindChip:    { flex: 1, height: 48, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  kindChipOn:  { backgroundColor: Colors.primary, borderColor: Colors.primary },
  kindText:    { ...Typography.labelMd, color: Colors.onSurface },
  kindTextOn:  { color: Colors.onPrimary },
  btn:         { marginTop: Spacing.sm },
});
