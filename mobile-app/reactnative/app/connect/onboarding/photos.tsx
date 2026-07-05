import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Plus, X, Camera } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import OnboardingStep from '@/features/connect/components/OnboardingStep';
import { useSaveOnboardingDraft } from '@/features/connect/hooks/useConnect';

// ON-08 — Profile wizard, photos. Upload/reorder; primary photo; guidelines.
// Media is moderated before public visibility (SAFETY INVARIANT §9) — handled
// server-side; here we just collect placeholders for the slots.
const SLOTS = 6;

export default function Photos() {
  const [photos, setPhotos] = useState<string[]>([]);
  const save = useSaveOnboardingDraft();

  const addPhoto = () => {
    // Real image picker is wired in a later slice; mock adds a placeholder URI.
    setPhotos((p) => (p.length < SLOTS ? [...p, `placeholder://${p.length + 1}`] : p));
  };
  const removePhoto = (i: number) => setPhotos((p) => p.filter((_, idx) => idx !== i));

  const onNext = () =>
    save.mutate({ photos }, { onSuccess: () => router.push('/connect/onboarding/bio') });

  const slots = Array.from({ length: SLOTS }, (_, i) => photos[i]);

  return (
    <OnboardingStep
      step={3}
      totalSteps={9}
      title="Add your photos"
      subtitle="Add at least one. Your first photo is your primary. Clear, recent photos build trust."
      primaryLabel="Continue"
      onPrimary={onNext}
      primaryDisabled={photos.length === 0}
      primaryLoading={save.isPending}
      footerNote="Photos are reviewed before they go public. No nudity, no contact info, no third parties."
    >
      <View style={styles.grid}>
        {slots.map((uri, i) => (
          <Pressable
            key={i}
            style={[styles.cell, i === 0 && styles.cellPrimary]}
            onPress={() => (uri ? removePhoto(i) : addPhoto())}
            accessibilityRole="button"
            accessibilityLabel={uri ? `Remove photo ${i + 1}` : `Add photo ${i + 1}`}
          >
            {uri ? (
              <>
                <View style={styles.filled}>
                  <Camera size={22} color={Colors.primary} strokeWidth={1.8} />
                </View>
                <View style={styles.removeBadge}>
                  <X size={12} color={Colors.onPrimary} strokeWidth={3} />
                </View>
                {i === 0 ? <Text style={styles.primaryTag}>Primary</Text> : null}
              </>
            ) : (
              <Plus size={22} color={Colors.outline} strokeWidth={2} />
            )}
          </Pressable>
        ))}
      </View>
    </OnboardingStep>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  cell: {
    width: '31%',
    aspectRatio: 0.8,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.surfaceContainerHigh,
    borderStyle: 'dashed',
    backgroundColor: Colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellPrimary: { borderColor: Colors.primary, borderStyle: 'solid' },
  filled: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.lg,
  },
  removeBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: Radius.full,
    backgroundColor: Colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryTag: {
    position: 'absolute',
    bottom: 4,
    ...Typography.caption,
    color: Colors.primary,
    backgroundColor: Colors.white,
    paddingHorizontal: 6,
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
});
