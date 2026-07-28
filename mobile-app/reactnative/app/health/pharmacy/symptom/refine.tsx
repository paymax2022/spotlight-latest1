import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import SymptomDisclaimerBar from '@/features/health/components/SymptomDisclaimerBar';
import {
  WHO_OPTIONS,
  DURATION_OPTIONS,
  type SymptomWho,
  type SymptomDuration,
} from '@/features/health/api/symptomSearch.api';
import { useSymptomSearchStore } from '@/features/health/pharmacy/symptomSearchStore';

/**
 * Refiner sheet (PRD §8, Journey A step 2) — ONE optional screen: Who is it
 * for? / How long? Single-select chips each, fully skippable. Refiners change
 * the answer (Journey B: pregnancy suppresses NSAID groups; Journey C: fever +
 * >3 days or child under 6 escalates) — so they are worth a tap, never a wall.
 */
export default function SymptomRefineScreen() {
  const { terms, refiners, setRefiners } = useSymptomSearchStore();

  const setWho = (who: SymptomWho) =>
    setRefiners({ ...refiners, who: refiners.who === who ? undefined : who });
  const setDuration = (duration: SymptomDuration) =>
    setRefiners({ ...refiners, duration: refiners.duration === duration ? undefined : duration });

  const goResults = () => router.push('/health/pharmacy/symptom/results');
  const skip = () => {
    setRefiners({});
    goResults();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Quick questions" subtitle="Optional — helps us show safer options" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.summary}>
          <Text style={styles.summaryText}>Your symptoms: {terms.join(' · ')}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Who is it for?</Text>
          <View style={styles.chipWrap}>
            {WHO_OPTIONS.map((o) => {
              const on = refiners.who === o.value;
              return (
                <Pressable
                  key={o.value}
                  onPress={() => setWho(o.value)}
                  style={[styles.chip, on && styles.chipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>How long has it lasted?</Text>
          <View style={styles.chipWrap}>
            {DURATION_OPTIONS.map((o) => {
              const on = refiners.duration === o.value;
              return (
                <Pressable
                  key={o.value}
                  onPress={() => setDuration(o.value)}
                  style={[styles.chip, on && styles.chipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="See options" onPress={goResults} />
        <Pressable onPress={skip} hitSlop={8} accessibilityRole="button" style={styles.skip}>
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
      </View>

      <SymptomDisclaimerBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.lg },
  summary: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
  },
  summaryText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  section: { gap: Spacing.sm },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md,
    height: 38,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { ...Typography.labelMd, color: Colors.onSurface },
  chipTextOn: { color: Colors.onPrimary },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.sm, gap: Spacing.xs },
  skip: { alignSelf: 'center', paddingVertical: Spacing.xs },
  skipText: { ...Typography.labelMd, color: Colors.secondary },
});
