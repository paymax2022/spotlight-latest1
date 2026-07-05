import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import IntakeField from '@/features/health/components/IntakeField';
import { usePets } from '@/features/health/vet/hooks';
import type { IntakeField as IntakeFieldT, IntakeResponseValues, IntakeValue } from '@/features/health/types';

// Self-contained vet triage schema (versioned via the shared intake type shape).
const TRIAGE_FIELDS: IntakeFieldT[] = [
  {
    id: 'reason',
    type: 'single_select',
    label: 'Main reason for the visit',
    required: true,
    options: [
      { value: 'skin', label: 'Skin / coat' },
      { value: 'digestive', label: 'Digestive' },
      { value: 'injury', label: 'Injury / lameness' },
      { value: 'behaviour', label: 'Behaviour' },
      { value: 'routine', label: 'Routine check-up' },
      { value: 'other', label: 'Other' },
    ],
  },
  { id: 'symptoms', type: 'long_text', label: 'Describe the symptoms', required: true, placeholder: 'When did it start? Any changes?' },
  { id: 'duration', type: 'short_text', label: 'How long has this been going on?', placeholder: 'e.g. 3 days' },
  { id: 'eating', type: 'boolean', label: 'Is your pet eating normally?', required: true },
  {
    id: 'urgency',
    type: 'single_select',
    label: 'How urgent does this feel?',
    required: true,
    help: 'If this is a life-threatening emergency, use Emergency SOS instead.',
    options: [
      { value: 'routine', label: 'Routine' },
      { value: 'soon', label: 'Needs attention soon' },
      { value: 'urgent', label: 'Urgent (not life-threatening)' },
    ],
  },
];

export default function TriageScreen() {
  const { vetId, petId } = useLocalSearchParams<{ vetId: string; petId?: string }>();
  const { data: pets } = usePets();
  const [selectedPet, setSelectedPet] = useState<string | undefined>(petId || undefined);
  const [values, setValues] = useState<IntakeResponseValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const petOptions = useMemo<IntakeFieldT>(
    () => ({
      id: 'pet',
      type: 'single_select',
      label: 'Which pet is this for?',
      required: true,
      options: (pets ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.breed})` })),
    }),
    [pets],
  );

  const setVal = (id: string, v: IntakeValue) => {
    setValues((prev) => ({ ...prev, [id]: v }));
    setErrors((prev) => ({ ...prev, [id]: '' }));
  };

  const onContinue = () => {
    const e: Record<string, string> = {};
    if (!selectedPet) e.pet = 'Select a pet';
    for (const f of TRIAGE_FIELDS) {
      if (f.required) {
        const v = values[f.id];
        if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) e[f.id] = 'This field is required';
      }
    }
    setErrors(e);
    if (Object.keys(e).length) return;

    router.push({
      pathname: '/health/vet/book',
      params: {
        vetId,
        petId: selectedPet!,
        reason: String(values.symptoms ?? values.reason ?? 'Consultation'),
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Triage" subtitle="A few questions before you book" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.trust}>
          <ShieldCheck size={16} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.trustText}>
            This helps your vet prepare. Your answers are private and only shared with the vet you book.
          </Text>
        </View>

        <IntakeField field={petOptions} value={selectedPet ?? null} error={errors.pet} onChange={(v) => setSelectedPet(v as string)} />

        {TRIAGE_FIELDS.map((f) => (
          <IntakeField key={f.id} field={f} value={values[f.id] ?? null} error={errors[f.id]} onChange={(v) => setVal(f.id, v)} />
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Continue to booking" onPress={onContinue} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, paddingBottom: 40 },
  trust: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.md },
  trustText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
