import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import OnboardingStep from '@/features/connect/components/OnboardingStep';
import TextInputField from '@/components/TextInputField';
import {
  useSaveOnboardingDraft,
  useSubmitDob,
} from '@/features/connect/hooks/useConnect';

// ON-07 — Profile wizard, basics. Name, DOB, gender, location.
// HARD 18+ AGE GATE (SAFETY INVARIANT §1): DOB is validated; suspected minors are
// flagged server-side and routed to the underage block screen. The backend owns
// the authoritative decision + admin-queue write.
const GENDERS = ['Woman', 'Man', 'Non-binary', 'Prefer not to say'];

function isValidDob(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());
}

export default function ProfileBasics() {
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('');
  const [location, setLocation] = useState('');
  const [dobError, setDobError] = useState<string | undefined>();

  const save = useSaveOnboardingDraft();
  const submitDob = useSubmitDob();

  const canContinue =
    name.trim().length >= 2 && isValidDob(dob) && gender.length > 0 && location.trim().length >= 2;

  const onNext = () => {
    if (!isValidDob(dob)) {
      setDobError('Enter your date of birth as YYYY-MM-DD.');
      return;
    }
    setDobError(undefined);
    submitDob.mutate(dob, {
      onSuccess: (res) => {
        if (res.underage) {
          // Routed to the underage block; the api already recorded the flag.
          router.replace('/connect/onboarding/underage');
          return;
        }
        save.mutate(
          { displayName: name.trim(), dob, gender, location: location.trim() },
          { onSuccess: () => router.push('/connect/onboarding/photos') },
        );
      },
      onError: () => setDobError('Could not verify your age. Please try again.'),
    });
  };

  return (
    <OnboardingStep
      step={2}
      totalSteps={9}
      title="The basics"
      subtitle="This helps people find the real you. You must be 18 or older."
      primaryLabel="Continue"
      onPrimary={onNext}
      primaryDisabled={!canContinue}
      primaryLoading={submitDob.isPending || save.isPending}
      footerNote="Your date of birth is used only to confirm you're 18+ and is never shown on your profile."
    >
      <TextInputField
        label="Display name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Amara"
        autoCapitalize="words"
      />

      <TextInputField
        label="Date of birth"
        value={dob}
        onChangeText={(t) => {
          setDob(t);
          if (dobError) setDobError(undefined);
        }}
        placeholder="YYYY-MM-DD"
        keyboardType="numbers-and-punctuation"
        error={dobError}
      />

      <View>
        <Text style={styles.label}>Gender</Text>
        <View style={styles.chips}>
          {GENDERS.map((g) => {
            const active = gender === g;
            return (
              <Pressable
                key={g}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setGender(g)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{g}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <TextInputField
        label="Location"
        value={location}
        onChangeText={setLocation}
        placeholder="e.g. Lagos, Nigeria"
        autoCapitalize="words"
      />
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
});
