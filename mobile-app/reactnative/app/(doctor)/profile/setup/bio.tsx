import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, WizardProgress } from '@/features/doctor/components';
import { useProfileDraft, useSaveProfileDraft } from '@/features/doctor/hooks';

const MIN_BIO = 40;
const MAX_BIO = 600;

export default function BioScreen() {
  const { data: draft, isLoading, isError, refetch } = useProfileDraft();
  const save = useSaveProfileDraft();
  const [bio, setBio] = useState<string | null>(null);

  useEffect(() => {
    if (draft && bio === null) setBio(draft.bio);
  }, [draft, bio]);

  const value = bio ?? '';
  const canSubmit = value.trim().length >= MIN_BIO;

  const handleNext = async () => {
    if (!draft) return;
    try {
      await save.mutateAsync({ draft: { bio: value.trim(), completedSteps: [...new Set([...draft.completedSteps, 'bio' as const])] } });
      router.push('/(doctor)/profile/setup/specialty');
    } catch { /* surfaced */ }
  };

  if (isLoading && !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Professional bio" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !draft || bio === null) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Professional bio" />
        <StateView variant="error" message="We could not load your profile." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Professional bio" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <WizardProgress current={3} total={19} label="Professional bio" />

          <SectionCard title="About you" style={styles.card}>
            <Text style={styles.hint}>Tell patients about your experience, focus areas and approach to care.</Text>
            <TextInputField
              label="Bio"
              placeholder="e.g. Family physician with over a decade of experience…"
              value={value}
              onChangeText={setBio}
              multiline
              maxLength={MAX_BIO}
              style={styles.textArea}
            />
            <Text style={styles.counter}>{value.trim().length}/{MAX_BIO} · minimum {MIN_BIO} characters</Text>
          </SectionCard>

          <PrimaryButton label="Continue" onPress={handleNext} loading={save.isPending} disabled={!canSubmit} style={styles.btn} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: Colors.background },
  flex:     { flex: 1 },
  content:  { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  card:     { marginBottom: Spacing.md },
  hint:     { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  textArea: { minHeight: 120, textAlignVertical: 'top' },
  counter:  { ...Typography.caption, color: Colors.onSurfaceVariant },
  btn:      { marginTop: Spacing.sm },
});
