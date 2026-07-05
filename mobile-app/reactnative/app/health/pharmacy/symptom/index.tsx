import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { X, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import SearchBar from '@/components/SearchBar';
import PrimaryButton from '@/components/PrimaryButton';
import SymptomDisclaimerBar from '@/features/health/components/SymptomDisclaimerBar';
import { SYMPTOM_CHIPS } from '@/features/health/api/symptomSearch.api';
import { useSymptomSearchStore } from '@/features/health/pharmacy/symptomSearchStore';

/**
 * Symptom search home (PRD §8, Journey A step 1) — "What are you feeling?"
 * Free text + tappable symptom chips, multi-select (max 5, per contract).
 * Symptom-guided product discovery — NOT diagnosis. The disclaimer bar below
 * is persistent and non-dismissable.
 */
export default function SymptomHomeScreen() {
  const { terms, toggleTerm, addTerm, removeTerm } = useSymptomSearchStore();
  const [text, setText] = useState('');

  const submitText = (value: string) => {
    addTerm(value);
    setText('');
  };

  const customTerms = terms.filter((t) => !(SYMPTOM_CHIPS as readonly string[]).includes(t));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="What are you feeling?" subtitle="Options for your symptoms — not a diagnosis" />

      <SearchBar
        placeholder="Type it your way… e.g. body dey pain me"
        value={text}
        onChangeText={setText}
        onSubmit={submitText}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {customTerms.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>You typed</Text>
            <View style={styles.chipWrap}>
              {customTerms.map((t) => (
                <Pressable
                  key={t}
                  onPress={() => removeTerm(t)}
                  style={[styles.chip, styles.chipOn]}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${t}`}
                >
                  <Text style={[styles.chipText, styles.chipTextOn]}>{t}</Text>
                  <X size={13} color={Colors.onPrimary} strokeWidth={2.5} />
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Common symptoms</Text>
          <View style={styles.chipWrap}>
            {SYMPTOM_CHIPS.map((chip) => {
              const on = terms.includes(chip);
              return (
                <Pressable
                  key={chip}
                  onPress={() => toggleTerm(chip)}
                  style={[styles.chip, on && styles.chipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={chip}
                >
                  {on ? <Check size={13} color={Colors.onPrimary} strokeWidth={2.5} /> : null}
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{chip}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.hint}>Pick up to 5. You can combine them — e.g. Headache + Fever.</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={terms.length ? `Continue (${terms.length})` : 'Continue'}
          onPress={() => router.push('/health/pharmacy/symptom/refine')}
          disabled={terms.length === 0}
        />
      </View>

      {/* Persistent, non-dismissable (PRD Journey A) */}
      <SymptomDisclaimerBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.lg },
  section: { gap: Spacing.sm },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.md,
    height: 38,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { ...Typography.labelMd, color: Colors.onSurface },
  chipTextOn: { color: Colors.onPrimary },
  hint: { ...Typography.caption, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.sm },
});
