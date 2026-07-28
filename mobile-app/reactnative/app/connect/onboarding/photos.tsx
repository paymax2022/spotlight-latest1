import React, { useState } from 'react';
import { View, Text, Pressable, Image, StyleSheet, Alert, Platform } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { X, ImagePlus, Camera } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import OnboardingStep from '@/features/connect/components/OnboardingStep';
import { useSaveOnboardingDraft } from '@/features/connect/hooks/useConnect';

// ON-08 — Profile wizard, photos. Real upload (library) + camera capture.
// Media is moderated before public visibility (SAFETY INVARIANT §9) — enforced
// server-side when the URIs are registered on onboarding completion.
const SLOTS = 6;

function notify(msg: string) {
  if (Platform.OS === 'web') {
    // Alert has limited support on web; fall back to console + no-op UI.
    // eslint-disable-next-line no-console
    console.warn(msg);
  } else {
    Alert.alert('Photos', msg);
  }
}

export default function Photos() {
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const save = useSaveOnboardingDraft();

  const addUri = (uri: string) =>
    setPhotos((p) => (p.length < SLOTS ? [...p, uri] : p));

  const pickFromLibrary = async () => {
    if (photos.length >= SLOTS) return;
    try {
      setBusy(true);
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        notify('Photo library access is needed to upload photos.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [4, 5],
        quality: 0.8,
      });
      if (!res.canceled && res.assets?.[0]?.uri) addUri(res.assets[0].uri);
    } catch {
      notify('Could not open the photo library.');
    } finally {
      setBusy(false);
    }
  };

  const takePhoto = async () => {
    if (photos.length >= SLOTS) return;
    try {
      setBusy(true);
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        notify('Camera access is needed to take a photo.');
        return;
      }
      const res = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [4, 5],
        quality: 0.8,
      });
      if (!res.canceled && res.assets?.[0]?.uri) addUri(res.assets[0].uri);
    } catch {
      notify('Camera is not available on this device.');
    } finally {
      setBusy(false);
    }
  };

  const removePhoto = (i: number) => setPhotos((p) => p.filter((_, idx) => idx !== i));

  const onNext = () =>
    save.mutate({ photos }, { onSuccess: () => router.push('/connect/onboarding/bio') });

  const slots = Array.from({ length: SLOTS }, (_, i) => photos[i]);
  const full = photos.length >= SLOTS;

  return (
    <OnboardingStep
      step={3}
      totalSteps={8}
      title="Add your photos"
      subtitle="Add at least one. Your first photo is your primary. Clear, recent photos build trust."
      primaryLabel="Continue"
      onPrimary={onNext}
      primaryDisabled={photos.length === 0}
      primaryLoading={save.isPending}
      footerNote="Photos are reviewed before they go public. No nudity, no contact info, no third parties."
    >
      <View style={styles.actions}>
        <Pressable
          style={[styles.actionBtn, (busy || full) && styles.actionBtnDisabled]}
          onPress={pickFromLibrary}
          disabled={busy || full}
          accessibilityRole="button"
          accessibilityLabel="Upload from library"
        >
          <ImagePlus size={18} color={Colors.primary} strokeWidth={2} />
          <Text style={styles.actionText}>Upload</Text>
        </Pressable>
        <Pressable
          style={[styles.actionBtn, (busy || full) && styles.actionBtnDisabled]}
          onPress={takePhoto}
          disabled={busy || full}
          accessibilityRole="button"
          accessibilityLabel="Take a photo"
        >
          <Camera size={18} color={Colors.primary} strokeWidth={2} />
          <Text style={styles.actionText}>Take photo</Text>
        </Pressable>
      </View>

      <View style={styles.grid}>
        {slots.map((uri, i) => (
          <Pressable
            key={i}
            style={[styles.cell, i === 0 && styles.cellPrimary]}
            onPress={() => (uri ? removePhoto(i) : pickFromLibrary())}
            accessibilityRole="button"
            accessibilityLabel={uri ? `Remove photo ${i + 1}` : `Add photo ${i + 1}`}
          >
            {uri ? (
              <>
                <Image source={{ uri }} style={styles.photo} resizeMode="cover" />
                <View style={styles.removeBadge}>
                  <X size={12} color={Colors.onPrimary} strokeWidth={3} />
                </View>
                {i === 0 ? <Text style={styles.primaryTag}>Primary</Text> : null}
              </>
            ) : (
              <ImagePlus size={22} color={Colors.outline} strokeWidth={2} />
            )}
          </Pressable>
        ))}
      </View>
      <Text style={styles.count}>{photos.length}/{SLOTS} added</Text>
    </OnboardingStep>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: Spacing.sm },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.iconBgPurple,
  },
  actionBtnDisabled: { opacity: 0.5 },
  actionText: { ...Typography.labelMd, color: Colors.primary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.md },
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
    overflow: 'hidden',
  },
  cellPrimary: { borderColor: Colors.primary, borderStyle: 'solid' },
  photo: { ...StyleSheet.absoluteFillObject, borderRadius: Radius.lg },
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
  count: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
});
