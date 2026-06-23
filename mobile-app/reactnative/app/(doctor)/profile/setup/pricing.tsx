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
import { CONSULT_FEE_PRESETS_KOBO } from '@/features/doctor/constants';
import { formatKobo } from '@/api/doctor.profile.api';
import type { ConsultationPricing } from '@/types/doctor.profile';

const nairaToKobo = (s: string): number => { const n = parseInt(s.replace(/[^0-9]/g, ''), 10); return Number.isNaN(n) ? 0 : n * 100; };
const koboToNaira = (kobo: number): string => (kobo > 0 ? String(Math.round(kobo / 100)) : '');

export default function PricingScreen() {
  const { data: draft, isLoading, isError, refetch } = useProfileDraft();
  const save = useSaveProfileDraft();
  const [form, setForm] = useState<ConsultationPricing | null>(null);

  useEffect(() => {
    if (draft && !form) setForm(draft.pricing);
  }, [draft, form]);

  const set = (patch: Partial<ConsultationPricing>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const canSubmit = !!form && form.videoFeeKobo > 0;

  const handleNext = async () => {
    if (!draft || !form) return;
    try {
      await save.mutateAsync({ draft: { pricing: form, completedSteps: [...new Set([...draft.completedSteps, 'pricing' as const])] } });
      router.push('/(doctor)/profile/setup/free-follow-up');
    } catch { /* surfaced */ }
  };

  if (isLoading && !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Consultation pricing" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !draft || !form) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Consultation pricing" />
        <StateView variant="error" message="We could not load your pricing." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Consultation pricing" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <WizardProgress current={16} total={19} label="Consultation pricing" />

          <SectionCard title="Quick presets (video fee)" style={styles.card}>
            <View style={styles.grid}>
              {CONSULT_FEE_PRESETS_KOBO.map((kobo) => {
                const on = form.videoFeeKobo === kobo;
                return (
                  <Pressable key={kobo} onPress={() => set({ videoFeeKobo: kobo })} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityLabel={formatKobo(kobo)}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{formatKobo(kobo)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </SectionCard>

          <SectionCard title="Fees per consultation (₦)" style={styles.card}>
            <TextInputField label="Video consult" placeholder="3500" value={koboToNaira(form.videoFeeKobo)} onChangeText={(v) => set({ videoFeeKobo: nairaToKobo(v) })} keyboardType="number-pad" />
            <TextInputField label="Audio consult" placeholder="3000" value={koboToNaira(form.audioFeeKobo)} onChangeText={(v) => set({ audioFeeKobo: nairaToKobo(v) })} keyboardType="number-pad" />
            <TextInputField label="Chat consult" placeholder="2000" value={koboToNaira(form.chatFeeKobo)} onChangeText={(v) => set({ chatFeeKobo: nairaToKobo(v) })} keyboardType="number-pad" />
            <Text style={styles.summary}>Video {formatKobo(form.videoFeeKobo)} · Audio {formatKobo(form.audioFeeKobo)} · Chat {formatKobo(form.chatFeeKobo)}</Text>
          </SectionCard>

          <SectionCard title="Availability" style={styles.card}>
            <ToggleRow label="Accept instant (on-demand) consults" value={form.acceptsInstant} onValueChange={(acceptsInstant) => set({ acceptsInstant })} />
          </SectionCard>

          <PrimaryButton label="Continue" onPress={handleNext} loading={save.isPending} disabled={!canSubmit} style={styles.btn} />
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
  grid:       { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip:       { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLow },
  chipOn:     { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  chipText:   { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextOn: { color: Colors.primary },
  summary:    { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  btn:        { marginTop: Spacing.sm },
});
