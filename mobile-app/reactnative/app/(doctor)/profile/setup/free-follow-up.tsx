import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, WizardProgress, ToggleRow } from '@/features/doctor/components';
import { useProfileDraft, useSaveProfileDraft } from '@/features/doctor/hooks';
import { FREE_FOLLOW_UP_WINDOW_OPTIONS } from '@/features/doctor/constants';
import type { FreeFollowUpPolicy } from '@/types/doctor.profile';

const toInt = (s: string): number => { const n = parseInt(s.replace(/[^0-9]/g, ''), 10); return Number.isNaN(n) ? 0 : n; };

export default function FreeFollowUpScreen() {
  const { data: draft, isLoading, isError, refetch } = useProfileDraft();
  const save = useSaveProfileDraft();
  const [form, setForm] = useState<FreeFollowUpPolicy | null>(null);

  useEffect(() => {
    if (draft && !form) setForm(draft.freeFollowUp);
  }, [draft, form]);

  const set = (patch: Partial<FreeFollowUpPolicy>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const handleNext = async () => {
    if (!draft || !form) return;
    try {
      await save.mutateAsync({ draft: { freeFollowUp: form, completedSteps: [...new Set([...draft.completedSteps, 'free_follow_up' as const])] } });
      router.push('/(doctor)/profile/setup/bank-account');
    } catch { /* surfaced */ }
  };

  if (isLoading && !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Free follow-up" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !draft || !form) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Free follow-up" />
        <StateView variant="error" message="We could not load your policy." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Free follow-up" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <WizardProgress current={17} total={19} label="Free follow-up policy" />

          <SectionCard title="Free follow-up policy" style={styles.card}>
            <Text style={styles.hint}>Offer patients free follow-up visits after a paid consultation.</Text>
            <ToggleRow label="Offer free follow-ups" value={form.enabled} onValueChange={(enabled) => set({ enabled })} />
          </SectionCard>

          {form.enabled && (
            <>
              <SectionCard title="Follow-up window (days)" style={styles.card}>
                <View style={styles.grid}>
                  {FREE_FOLLOW_UP_WINDOW_OPTIONS.map((d) => {
                    const on = form.windowDays === d;
                    return (
                      <Pressable key={d} onPress={() => set({ windowDays: d })} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityLabel={`${d} days`}>
                        <Text style={[styles.chipText, on && styles.chipTextOn]}>{d} days</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </SectionCard>

              <SectionCard title="Details" style={styles.card}>
                <TextInputField label="Max free visits per consult" placeholder="1" value={form.maxFreeVisits ? String(form.maxFreeVisits) : ''} onChangeText={(v) => set({ maxFreeVisits: toInt(v) })} keyboardType="number-pad" maxLength={2} />
                <TextInputField label="Policy note (optional)" placeholder="Shown to patients" value={form.note ?? ''} onChangeText={(note) => set({ note })} multiline style={styles.textArea} />
              </SectionCard>
            </>
          )}

          <PrimaryButton label="Continue" onPress={handleNext} loading={save.isPending} style={styles.btn} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  flex:       { flex: 1 },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  card:       { marginBottom: Spacing.md },
  hint:       { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  grid:       { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip:       { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLow },
  chipOn:     { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  chipText:   { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextOn: { color: Colors.primary },
  textArea:   { minHeight: 70, textAlignVertical: 'top' },
  btn:        { marginTop: Spacing.sm },
});
