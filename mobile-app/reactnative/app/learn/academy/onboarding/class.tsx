import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { CLASS_OPTIONS } from '@/features/academy/constants';
import { useCurriculumVersions, useUpdateProfile } from '@/features/academy/hooks';

/**
 * A9 — Class & curriculum select (P1–SSS3). The entry class auto-detects whether
 * the learner sits on the new NERDC curriculum or the legacy version.
 */
export default function ClassSelectScreen() {
  const versions = useCurriculumVersions();
  const updateProfile = useUpdateProfile();
  const [classCode, setClassCode] = useState<string | null>(null);

  // New-vs-legacy auto-detect: SSS3 sits the legacy syllabus this cycle.
  const detectVersion = (code: string) => {
    const legacy = versions.data?.find((v) => v.isLegacy);
    const current = versions.data?.find((v) => !v.isLegacy);
    return code === 'SSS3' ? legacy?.id ?? current?.id : current?.id;
  };

  const finish = () => {
    if (!classCode) return;
    // Save the class + curriculum, then run the curriculum-grounded placement quiz
    // (it completes onboarding once the learner finishes or skips it).
    updateProfile.mutate(
      { classCode, curriculumVersion: detectVersion(classCode) },
      { onSuccess: () => router.push({ pathname: '/learn/academy/onboarding/placement', params: { class: classCode } }) },
    );
  };

  const bands: { key: 'primary' | 'jss' | 'sss'; label: string }[] = [
    { key: 'primary', label: 'Primary' },
    { key: 'jss', label: 'Junior Secondary' },
    { key: 'sss', label: 'Senior Secondary' },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Your class" subtitle="Step 4 of 4 · Curriculum" />
      {versions.isLoading ? (
        <StateView kind="loading" message="Loading curriculum…" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.lead}>Pick your current class. We’ll match the right curriculum automatically.</Text>
          {bands.map((band) => (
            <View key={band.key} style={styles.band}>
              <Text style={styles.bandLabel}>{band.label}</Text>
              <View style={styles.grid}>
                {CLASS_OPTIONS.filter((c) => c.band === band.key).map((c) => {
                  const active = classCode === c.value;
                  return (
                    <Pressable
                      key={c.value}
                      onPress={() => setClassCode(c.value)}
                      style={[styles.pill, active && styles.pillActive]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                    >
                      {active ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}
                      <Text style={[styles.pillText, active && styles.pillTextActive]}>{c.value}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}

          {classCode ? (
            <View style={styles.detected}>
              <Text style={styles.detectedText}>
                Curriculum: {versions.data?.find((v) => v.id === detectVersion(classCode))?.label ?? '—'}
              </Text>
            </View>
          ) : null}
        </ScrollView>
      )}
      <View style={styles.footer}>
        <PrimaryButton label="Start learning" onPress={finish} disabled={!classCode} loading={updateProfile.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin },
  lead: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  band: { marginBottom: Spacing.lg },
  bandLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm, textTransform: 'uppercase' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: Spacing.md, paddingVertical: 10,
    borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  pillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pillText: { ...Typography.labelMd, color: Colors.onSurface },
  pillTextActive: { color: Colors.onPrimary },
  detected: { backgroundColor: Colors.iconBgTeal, padding: Spacing.md, borderRadius: Radius.md },
  detectedText: { ...Typography.bodySm, color: Colors.onSurface },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
