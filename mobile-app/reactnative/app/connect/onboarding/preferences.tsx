import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import OnboardingStep from '@/features/connect/components/OnboardingStep';
import ToggleRow from '@/features/connect/components/ToggleRow';
import { useSaveOnboardingDraft } from '@/features/connect/hooks/useConnect';

// ON-10 — Profile wizard, preferences. Discovery prefs per mode.
const SHOW_ME = ['Women', 'Men', 'Everyone'];
const DISTANCES = [10, 25, 50, 100];

export default function Preferences() {
  const [showMe, setShowMe] = useState('Everyone');
  const [distanceKm, setDistanceKm] = useState(25);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const save = useSaveOnboardingDraft();

  const onNext = () =>
    save.mutate(
      { preferences: { showMe, distanceKm, verifiedOnly } },
      { onSuccess: () => router.replace('/connect/onboarding/complete') },
    );

  return (
    <OnboardingStep
      step={5}
      totalSteps={5}
      title="Discovery preferences"
      subtitle="Fine-tune who you see. You can change these anytime in settings."
      primaryLabel="Finish"
      onPrimary={onNext}
      primaryLoading={save.isPending}
    >
      <View>
        <Text style={styles.label}>Show me</Text>
        <View style={styles.chips}>
          {SHOW_ME.map((s) => {
            const active = showMe === s;
            return (
              <Pressable key={s} style={[styles.chip, active && styles.chipActive]} onPress={() => setShowMe(s)}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{s}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View>
        <Text style={styles.label}>Maximum distance</Text>
        <View style={styles.chips}>
          {DISTANCES.map((d) => {
            const active = distanceKm === d;
            return (
              <Pressable key={d} style={[styles.chip, active && styles.chipActive]} onPress={() => setDistanceKm(d)}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{d} km</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.card}>
        <ToggleRow
          label="Verified profiles only"
          sub="Only show people who've completed identity verification"
          value={verifiedOnly}
          onValueChange={setVerifiedOnly}
        />
      </View>
    </OnboardingStep>
  );
}

const styles = StyleSheet.create({
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    borderColor: Colors.surfaceContainerHigh,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  chipActive: { borderColor: Colors.primary, backgroundColor: Colors.iconBgPurple },
  chipText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextActive: { color: Colors.primary },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    paddingHorizontal: Spacing.md,
  },
});
