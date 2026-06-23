import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, KeyboardAvoidingView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Send, Stethoscope } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { DoctorAvatar } from '@/features/telemedicine/components';
import { SoapSection, SectionCard, StateView, StatusBadge } from '@/features/doctor/components';
import { useVetSpecialists, useVetReferrals, useCreateVetReferral } from '@/features/doctor/hooks';
import { VET_REFERRAL_STATUS_LABELS, VET_REFERRAL_URGENCY_OPTIONS } from '@/features/doctor/constants';
import type { StatusTone } from '@/features/doctor/components';
import type { VetReferralStatus, VetReferral } from '@/types/doctor.batch5';

const STATUS_TONE: Record<VetReferralStatus, StatusTone> = {
  draft: 'neutral', sent: 'info', accepted: 'brand', scheduled: 'warning', completed: 'success', declined: 'danger',
};

export default function VetReferralScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const petId = String(id);

  const { data: specialists = [], isLoading, isError, refetch } = useVetSpecialists();
  const { data: referrals = [] } = useVetReferrals(petId);
  const create = useCreateVetReferral();

  const [specialistId, setSpecialistId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [urgency, setUrgency] = useState<VetReferral['urgency']>('routine');

  const canSubmit = !!specialistId && !!reason.trim();

  const handleSubmit = async () => {
    if (!specialistId) { Alert.alert('Select a specialist', 'Choose who to refer to.'); return; }
    if (!reason.trim()) { Alert.alert('Add a reason', 'Describe why you are referring.'); return; }
    try {
      const result = await create.mutateAsync({ petId, specialistId, reason, urgency });
      Alert.alert('Referral created', `${result.ref} has been sent.`, [{ text: 'Done' }]);
      setReason(''); setSpecialistId(null);
    } catch { Alert.alert('Failed', 'Could not create the referral. Please try again.'); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Vet Referral" />

      {isLoading && specialists.length === 0 ? (
        <StateView variant="loading" label="Loading specialists" />
      ) : isError ? (
        <StateView variant="error" message="We could not load specialists." onRetry={() => refetch()} />
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {referrals.length > 0 && (
              <SectionCard title="Existing referrals" style={styles.card}>
                {referrals.map((r, i) => (
                  <View key={r.id} style={[styles.refRow, i > 0 && styles.rowBorder]}>
                    <View style={styles.refBody}>
                      <Text style={styles.refRef}>{r.ref} - {r.specialist.name}</Text>
                      <Text style={styles.refMeta} numberOfLines={1}>{r.specialist.specialty} - {r.reason}</Text>
                    </View>
                    <StatusBadge label={VET_REFERRAL_STATUS_LABELS[r.status]} tone={STATUS_TONE[r.status]} />
                  </View>
                ))}
              </SectionCard>
            )}

            <Text style={styles.sectionTitle}>Choose a specialist</Text>
            <View style={styles.list}>
              {specialists.map((s) => {
                const active = specialistId === s.id;
                return (
                  <Pressable
                    key={s.id}
                    style={[styles.specRow, active && styles.specRowOn]}
                    onPress={() => setSpecialistId(s.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Refer to ${s.name}`}
                  >
                    <DoctorAvatar initials={s.initials} color={s.avatarColor} size={40} />
                    <View style={styles.specBody}>
                      <Text style={styles.specName}>{s.name}</Text>
                      <Text style={styles.specMeta} numberOfLines={1}>{s.specialty} - {s.clinic}</Text>
                    </View>
                    <Stethoscope size={18} color={active ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2} />
                  </Pressable>
                );
              })}
            </View>

            <SectionCard title="Urgency" style={styles.card}>
              <View style={styles.urgencyRow}>
                {VET_REFERRAL_URGENCY_OPTIONS.map((o) => {
                  const active = urgency === o.value;
                  return (
                    <Pressable key={o.value} onPress={() => setUrgency(o.value)} style={[styles.urgencyChip, active && styles.urgencyChipOn]} accessibilityRole="button" accessibilityLabel={o.label}>
                      <Text style={[styles.urgencyText, active && styles.urgencyTextOn]}>{o.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </SectionCard>

            <SoapSection label="Reason for referral" value={reason} onChangeText={setReason} placeholder="e.g. Suspected cruciate ligament rupture — needs orthopaedic assessment" />

            <PrimaryButton label="Create referral" onPress={handleSubmit} loading={create.isPending} disabled={!canSubmit} style={styles.btn} />
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: Colors.background },
  flex:          { flex: 1 },
  content:       { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  card:          { marginBottom: Spacing.md },
  sectionTitle:  { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  list:          { gap: Spacing.sm, marginBottom: Spacing.md },
  refRow:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  refBody:       { flex: 1, gap: 2 },
  refRef:        { ...Typography.labelMd, color: Colors.onSurface },
  refMeta:       { ...Typography.caption, color: Colors.onSurfaceVariant },
  rowBorder:     { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  specRow:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  specRowOn:     { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  specBody:      { flex: 1, gap: 2 },
  specName:      { ...Typography.labelLg, color: Colors.onSurface },
  specMeta:      { ...Typography.caption, color: Colors.onSurfaceVariant },
  urgencyRow:    { flexDirection: 'row', gap: Spacing.sm },
  urgencyChip:   { flex: 1, height: 48, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  urgencyChipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  urgencyText:   { ...Typography.labelMd, color: Colors.onSurface },
  urgencyTextOn: { color: Colors.onPrimary },
  btn:           { marginTop: Spacing.sm },
});
