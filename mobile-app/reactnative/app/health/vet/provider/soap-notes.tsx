import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useSaveSoapNote } from '@/features/health/vet/hooks';

const FIELDS: { key: 'subjective' | 'objective' | 'assessment' | 'plan'; label: string; placeholder: string }[] = [
  { key: 'subjective', label: 'Subjective', placeholder: 'Owner-reported history & complaints' },
  { key: 'objective', label: 'Objective', placeholder: 'Exam findings, vitals, measurements' },
  { key: 'assessment', label: 'Assessment', placeholder: 'Clinical assessment' },
  { key: 'plan', label: 'Plan', placeholder: 'Treatment plan, follow-up, instructions' },
];

export default function SoapNotesScreen() {
  const { appointmentId, petId } = useLocalSearchParams<{ appointmentId?: string; petId: string }>();
  const save = useSaveSoapNote();

  const [soap, setSoap] = useState({ subjective: '', objective: '', assessment: '', plan: '' });
  const [diagnosis, setDiagnosis] = useState('');
  const [followUp, setFollowUp] = useState(false);
  const [followNote, setFollowNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setField = (k: keyof typeof soap, v: string) => {
    setSoap((prev) => ({ ...prev, [k]: v }));
    setErrors((prev) => ({ ...prev, [k]: '' }));
  };

  const onSave = () => {
    const e: Record<string, string> = {};
    if (!soap.assessment.trim()) e.assessment = 'Assessment is required';
    if (!diagnosis.trim()) e.diagnosis = 'Diagnosis is required';
    setErrors(e);
    if (Object.keys(e).length) return;

    save.mutate(
      {
        appointmentId: appointmentId ?? 'appt',
        petId,
        soap,
        diagnosis: diagnosis.trim(),
        followUpRecommended: followUp,
        followUpNote: followNote.trim() || undefined,
      },
      {
        onSuccess: (res) =>
          router.replace({ pathname: '/health/vet/provider/eprescribe', params: { appointmentId: appointmentId ?? '', petId, summaryId: res.summaryId } }),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="SOAP notes" subtitle="Clinical consult notes (HL-12 audited)" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {FIELDS.map((f) => (
          <TextInputField
            key={f.key}
            label={f.label}
            placeholder={f.placeholder}
            value={soap[f.key]}
            onChangeText={(t) => setField(f.key, t)}
            error={errors[f.key]}
            multiline
          />
        ))}

        <TextInputField label="Diagnosis *" placeholder="Primary diagnosis" value={diagnosis} onChangeText={setDiagnosis} error={errors.diagnosis} />

        <View style={styles.followRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.followLabel}>Recommend a follow-up</Text>
            <Text style={styles.followSub}>Owner will see a follow-up CTA in their summary.</Text>
          </View>
          <Switch
            value={followUp}
            onValueChange={setFollowUp}
            trackColor={{ true: Colors.secondaryContainer, false: Colors.outlineVariant }}
            thumbColor={Colors.white}
          />
        </View>
        {followUp ? (
          <TextInputField label="Follow-up note" placeholder="e.g. Recheck in 2 weeks" value={followNote} onChangeText={setFollowNote} />
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Save & continue to prescribe" onPress={onSave} loading={save.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, paddingBottom: 40 },
  followRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md },
  followLabel: { ...Typography.labelLg, color: Colors.onSurface },
  followSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
