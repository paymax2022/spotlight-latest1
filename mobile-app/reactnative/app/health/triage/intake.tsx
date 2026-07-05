import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import PrimaryButton from '@/components/PrimaryButton';
import { TriageScaffold, CautionBanner } from '@/features/triage/components';
import { useSubmitIntake, useProfiles } from '@/features/triage/hooks';
import { useLanguage } from '@/features/triage/useLanguage';
import { t } from '@/features/triage/i18n';
import { BODY_REGIONS, COMMON_SYMPTOMS } from '@/features/triage/constants';
import type { BodyRegion } from '@/features/triage/types';

export default function TriageIntakeScreen() {
  const params = useLocalSearchParams<{ sessionId?: string; profileId?: string }>();
  const sessionId = params.sessionId;
  const [lang, setLang] = useLanguage();
  const s = t(lang);
  const { data: profiles } = useProfiles();
  const profile = profiles?.find((p) => p.id === params.profileId);

  const [text, setText] = useState('');
  const [regions, setRegions] = useState<BodyRegion[]>([]);
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const intake = useSubmitIntake(sessionId);

  const toggleRegion = (r: BodyRegion) =>
    setRegions((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  const toggleSymptom = (v: string) =>
    setSymptoms((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

  // Build the raw_text the engine sees from free-text + taps (low-literacy path).
  const composedText = [
    text.trim(),
    symptoms.map((v) => COMMON_SYMPTOMS.find((c) => c.value === v)?.label).filter(Boolean).join(', '),
    regions.length ? `Affected areas: ${regions.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('. ');

  const canContinue = composedText.length > 0;

  const onContinue = () => {
    if (!canContinue || !sessionId) return;
    intake.mutate(
      { rawText: composedText, bodyMap: regions },
      {
        onSuccess: (step) => {
          if (step.redFlag || step.disposition === 1 || step.disposition === 2) {
            router.replace({ pathname: '/health/triage/emergency', params: { sessionId } });
            return;
          }
          router.push({
            pathname: '/health/triage/interview',
            params: { sessionId, profileId: params.profileId },
          });
        },
      },
    );
  };

  return (
    <TriageScaffold title={s.intakeTitle} lang={lang} onChangeLang={setLang} sessionId={sessionId}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <CautionBanner lang={lang} profile={profile} />

        {/* Free-text box */}
        <Text style={styles.label}>{s.intakePrompt}</Text>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={s.intakePlaceholder}
          placeholderTextColor={Colors.onSurfaceVariant}
          multiline
          style={styles.textbox}
          textAlignVertical="top"
        />

        {/* Body-map (low-literacy) */}
        <Text style={styles.label}>{s.bodyMapHint}</Text>
        <View style={styles.bodyMap}>
          {BODY_REGIONS.map(({ region, label, labelPcm }) => {
            const active = regions.includes(region);
            return (
              <Pressable
                key={region}
                onPress={() => toggleRegion(region)}
                style={[styles.regionChip, active && styles.regionChipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.regionText, active && styles.regionTextActive]}>
                  {lang === 'pcm' ? labelPcm : label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Big-button common symptoms */}
        <Text style={styles.label}>{s.commonSymptomsHint}</Text>
        <View style={styles.symptomGrid}>
          {COMMON_SYMPTOMS.map(({ value, label, labelPcm, icon }) => {
            const active = symptoms.includes(value);
            const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[icon] ?? Icons.Activity;
            return (
              <Pressable
                key={value}
                onPress={() => toggleSymptom(value)}
                style={[styles.symptomBtn, shadow1, active && styles.symptomBtnActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Icon size={26} color={active ? Colors.onPrimary : Colors.primary} strokeWidth={2} />
                <Text style={[styles.symptomLabel, active && styles.symptomLabelActive]}>
                  {lang === 'pcm' ? labelPcm : label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label={s.continue} onPress={onContinue} disabled={!canContinue} loading={intake.isPending} />
      </View>
    </TriageScaffold>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.containerMargin, paddingBottom: 24, gap: Spacing.md },
  label: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.xs },
  textbox: {
    ...Typography.bodyMd,
    color: Colors.onSurface,
    minHeight: 96,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
  },
  bodyMap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  regionChip: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
  },
  regionChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  regionText: { ...Typography.labelMd, color: Colors.onSurface },
  regionTextActive: { color: Colors.onPrimary },
  symptomGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  symptomBtn: {
    width: '48%',
    minHeight: 88,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    padding: Spacing.md,
  },
  symptomBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  symptomLabel: { ...Typography.labelMd, color: Colors.onSurface, textAlign: 'center' },
  symptomLabelActive: { color: Colors.onPrimary },
  footer: {
    padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
  },
});
