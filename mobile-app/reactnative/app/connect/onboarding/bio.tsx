import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import OnboardingStep from '@/features/connect/components/OnboardingStep';
import TextInputField from '@/components/TextInputField';
import { useSaveOnboardingDraft } from '@/features/connect/hooks/useConnect';

// ON-09 — Profile wizard, bio/prompts. Bio, interests, (networking) headline.
const INTERESTS = ['Music', 'Tech', 'Travel', 'Fitness', 'Food', 'Art', 'Movies', 'Gaming', 'Fashion', 'Business', 'Faith', 'Football'];
const MAX_BIO = 300;

export default function Bio() {
  const [bio, setBio] = useState('');
  const [headline, setHeadline] = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const save = useSaveOnboardingDraft();

  const toggle = (v: string) =>
    setInterests((p) => (p.includes(v) ? p.filter((x) => x !== v) : p.length < 6 ? [...p, v] : p));

  const onNext = () =>
    save.mutate(
      { bio: bio.trim(), headline: headline.trim() || undefined, interests },
      { onSuccess: () => router.push('/connect/onboarding/preferences') },
    );

  return (
    <OnboardingStep
      step={4}
      totalSteps={5}
      title="Tell your story"
      subtitle="A short bio and a few interests go a long way."
      primaryLabel="Continue"
      onPrimary={onNext}
      primaryDisabled={interests.length === 0}
      primaryLoading={save.isPending}
    >
      <TextInputField
        label="Headline (networking)"
        value={headline}
        onChangeText={setHeadline}
        placeholder="e.g. Product designer building fintech"
      />

      <View>
        <TextInputField
          label="Bio"
          value={bio}
          onChangeText={(t) => t.length <= MAX_BIO && setBio(t)}
          placeholder="What makes you, you?"
          multiline
          numberOfLines={4}
          style={styles.bioInput}
        />
        <Text style={styles.counter}>{bio.length}/{MAX_BIO}</Text>
      </View>

      <View>
        <Text style={styles.label}>Interests (up to 6)</Text>
        <View style={styles.chips}>
          {INTERESTS.map((it) => {
            const active = interests.includes(it);
            return (
              <Pressable
                key={it}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => toggle(it)}
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{it}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </OnboardingStep>
  );
}

const styles = StyleSheet.create({
  bioInput: { minHeight: 96, textAlignVertical: 'top' },
  counter: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'right', marginTop: -Spacing.sm },
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
});
