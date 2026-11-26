// The applicant's own picture, on their own status page.
//
// Two places carry it and both are legitimate depending on how far the entry has
// got: the registration answers hold `media.profilePhoto` (or the public-profile
// step's `publicProfile.profilePhoto`) as an object, and once the application is
// promoted the same object is stored as JSON text in the roster's photo column.
// The pure helpers in `utils/profile-photo` read either shape; this component
// only turns the result into pixels.
//
// Why a network call is involved: a stored upload's `previewUrl` is a
// root-relative, auth-gated route (`/api/registration/uploads/<key>`). An
// <Image> cannot attach the bearer token to it, so the API is asked for a short
// directly-loadable URL first — the same dance the wizard's review step does.
//
// What it will never do is fall back to the KYC identity document. That is a
// passport, not a profile picture, and putting it on a page about a public
// contest is a privacy leak. No document, no photo: an initial is honest, the
// applicant's ID is not.
import React, { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import { resolveUploadUrl } from '../api/registration.client';
import { pickProfilePhoto, profilePhotoFromStored } from '../utils/profile-photo';

interface Props {
  /** The applicant's saved answers — the first place their picture is looked for. */
  formData?: Record<string, unknown> | null;
  /** `contestants.photo_url`: the same object as JSON text, or a bare URL. */
  rosterPhoto?: string | null;
  /** Called when no stored photo can be loaded. */
  onMissingPhoto?: () => void;
  /** Used for the initial when there is no picture to show. */
  name?: string | null;
  size?: number;
}

export default function ProfilePhotoAvatar({ formData, rosterPhoto, onMissingPhoto, name, size = 56 }: Props) {
  const photo = pickProfilePhoto(formData ?? undefined) ?? profilePhotoFromStored(rosterPhoto);
  const storedUrl = photo?.previewUrl ?? null;
  const [loadableUrl, setLoadableUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!storedUrl) {
      setLoadableUrl(null);
      onMissingPhoto?.();
      return;
    }
    resolveUploadUrl(storedUrl)
      .then((url) => {
        if (active) setLoadableUrl(url);
      })
      .catch(() => {
        // A preview the API cannot sign is a missing picture, not an error to
        // shout about on a status page.
        if (active) {
          setLoadableUrl(null);
          onMissingPhoto?.();
        }
      });
    return () => {
      active = false;
    };
  }, [onMissingPhoto, storedUrl]);

  const initial = String(name ?? '').trim().charAt(0).toUpperCase();
  const circle = { width: size, height: size, borderRadius: size / 2 };

  if (loadableUrl) {
    return (
      <Image
        source={{ uri: loadableUrl }}
        style={[styles.image, circle]}
        accessibilityLabel="Your profile photo"
        onError={() => onMissingPhoto?.()}
      />
    );
  }

  return (
    <View style={[styles.placeholder, circle]}>
      <Text style={[styles.initial, { fontSize: Math.round(size * 0.4) }]}>{initial || '·'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: Colors.surfaceContainerHigh },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primaryContainer,
  },
  initial: { ...Typography.labelLg, color: Colors.onPrimaryContainer, fontWeight: '700' },
});
