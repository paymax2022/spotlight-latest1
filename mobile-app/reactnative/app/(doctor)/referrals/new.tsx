import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, KeyboardAvoidingView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, SoapSection, StateView } from '@/features/doctor/components';
import { useSpecialists, useCreateReferral } from '@/features/doctor/hooks';
import { REFERRAL_SPECIALTY_OPTIONS, REFERRAL_URGENCY_OPTIONS } from '@/features/doctor/constants';
import type { SpecialistReferral } from '@/types/doctor.phase2';

export default function NewReferralScreen() {
  const { patientId, patientName } = useLocalSearchParams<{ patientId?: string; patientName?: string }>();

  const [specialty, setSpecialty] = useState('');
  const [specialistId, setSpecialistId] = useState('');
  const [reason, setReason] = useState('');
  const [urgency, setUrgency] = useState<SpecialistReferral['urgency']>('routine');

  const { data: specialists = [], isLoading, isError, refetch } = useSpecialists(specialty || undefined);
  const create = useCreateReferral();

  const filtered = useMemo(
    () => (specialty ? specialists.filter((s) => s.specialty === specialty) : specialists),
    [specialists, specialty],
  );

  const canSubmit = !!patientId && !!specialistId && reason.trim().length > 0;

  const handleSubmit = async () => {
    if (!patientId) {
      Alert.alert('No patient', 'Open a referral from a patient record to select the patient.');
      return;
    }
    if (!canSubmit) {
      Alert.alert('Incomplete', 'Choose a specialist and add a reason for the referral.');
      return;
    }
    try {
      const result = await create.mutateAsync({
        patientId: String(patientId),
        specialistId,
        reason: reason.trim(),
        urgency,
        attachments: [],
      });
      Alert.alert('Referral sent', `${result.ref} has been created.`, [
        { text: 'View', onPress: () => router.replace(`/(doctor)/referrals/${result.referralId}`) },
      ]);
    } catch {
      Alert.alert('Failed', 'Could not create the referral. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="New Referral" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {!!patientName && <Text style={styles.patientLine}>For {patientName}</Text>}

          <SelectField
            label="Specialty"
            placeholder="All specialties"
            value={specialty}
            options={REFERRAL_SPECIALTY_OPTIONS}
            onChange={(v) => { setSpecialty(v); setSpecialistId(''); }}
          />

          <Text style={styles.sectionTitle}>Specialist</Text>
          {isLoading && specialists.length === 0 ? (
            <StateView variant="loading" label="Loading specialists" />
          ) : isError ? (
            <StateView variant="error" message="We could not load specialists." onRetry={() => refetch()} />
          ) : filtered.length === 0 ? (
            <StateView variant="empty" icon={Check} title="No specialists" message="Try a different specialty." />
          ) : (
            <View style={styles.specialists}>
              {filtered.map((s) => {
                const active = s.id === specialistId;
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => setSpecialistId(s.id)}
                    style={[styles.specialistRow, active && styles.specialistRowOn]}
                    accessibilityRole="button"
                    accessibilityLabel={`Select ${s.name}`}
                  >
                    <View style={[styles.avatar, { backgroundColor: s.avatarColor }]}>
                      <Text style={styles.avatarText}>{s.initials}</Text>
                    </View>
                    <View style={styles.specialistBody}>
                      <Text style={styles.specialistName} numberOfLines={1}>{s.name}</Text>
                      <Text style={styles.specialistMeta} numberOfLines={1}>{s.specialty} · {s.hospital}</Text>
                    </View>
                    {active && <Check size={18} color={Colors.primary} strokeWidth={2.5} />}
                  </Pressable>
                );
              })}
            </View>
          )}

          <SectionCard title="Urgency" style={styles.card}>
            <View style={styles.urgencyRow}>
              {REFERRAL_URGENCY_OPTIONS.map((o) => {
                const active = urgency === o.value;
                return (
                  <Pressable
                    key={o.value}
                    onPress={() => setUrgency(o.value)}
                    style={[styles.urgencyChip, active && styles.urgencyChipOn]}
                    accessibilityRole="button"
                    accessibilityLabel={`Urgency ${o.label}`}
                  >
                    <Text style={[styles.urgencyText, active && styles.urgencyTextOn]}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </SectionCard>

          <SoapSection label="Reason for referral" hint="Clinical context for the specialist" value={reason} onChangeText={setReason} placeholder="e.g. Persistent hypertension despite triple therapy" />

          <PrimaryButton label="Send referral" onPress={handleSubmit} loading={create.isPending} disabled={!canSubmit} style={styles.btn} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: Colors.background },
  flex:           { flex: 1 },
  content:        { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  patientLine:    { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  sectionTitle:   { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  specialists:    { gap: Spacing.sm, marginBottom: Spacing.md },
  specialistRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh },
  specialistRowOn:{ borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  avatar:         { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  avatarText:     { ...Typography.labelMd, color: Colors.white, fontWeight: '800' },
  specialistBody: { flex: 1, gap: 2 },
  specialistName: { ...Typography.labelLg, color: Colors.onSurface },
  specialistMeta: { ...Typography.caption, color: Colors.onSurfaceVariant },
  card:           { marginBottom: Spacing.md },
  urgencyRow:     { flexDirection: 'row', gap: Spacing.sm },
  urgencyChip:    { flex: 1, height: 48, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  urgencyChipOn:  { backgroundColor: Colors.primary, borderColor: Colors.primary },
  urgencyText:    { ...Typography.labelMd, color: Colors.onSurface },
  urgencyTextOn:  { color: Colors.onPrimary },
  btn:            { marginTop: Spacing.sm },
});
