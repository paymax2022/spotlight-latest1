// ── Property photo manager (Airbnb-style "Photos" section) ──────────────────
// Camera/gallery pick → presign → PUT → confirm (see api.ts uploadPropertyPhoto),
// same shape as the marketplace Sell composer's image upload. Grid layout (not
// a horizontal strip) because a property listing wants to show many photos at
// once, not a single hero row.
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Image, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Star, Trash2, ImagePlus, Camera } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { confirmAsync, alertAsync } from '@/lib/confirm';
import {
  usePropertyPhotos, useUploadPhoto, useSetCoverPhoto, useDeletePhoto,
} from '@/features/stayshotelier/hooks';

function extensionForMime(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

export default function PhotoGrid({ propertyId }: { propertyId: string }) {
  const photos = usePropertyPhotos(propertyId);
  const upload = useUploadPhoto(propertyId);
  const setCover = useSetCoverPhoto(propertyId);
  const del = useDeletePhoto(propertyId);
  const [uploadingCount, setUploadingCount] = useState(0);

  const pick = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      if (fromCamera) {
        const ok = await confirmAsync({
          title: 'Camera unavailable',
          message: "We couldn't open the camera. Pick photos from your gallery instead.",
          confirmLabel: 'Open gallery',
        });
        if (ok) pick(false);
      } else {
        alertAsync({ title: 'Permission needed', message: 'Allow photo access to add listing photos.' });
      }
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsMultipleSelection: true, selectionLimit: 20 });
    if (result.canceled || !result.assets?.length) return;

    setUploadingCount((n) => n + result.assets.length);
    for (const asset of result.assets) {
      const mimeType = asset.mimeType || 'image/jpeg';
      try {
        await upload.mutateAsync({ uri: asset.uri, mimeType, caption: '' });
      } catch {
        alertAsync({ title: 'Upload failed', message: 'One of your photos could not be uploaded. Try again.' });
      } finally {
        setUploadingCount((n) => Math.max(0, n - 1));
      }
    }
  };

  const remove = async (photoId: string) => {
    const ok = await confirmAsync({ title: 'Remove this photo?', destructive: true, confirmLabel: 'Remove' });
    if (ok) del.mutate(photoId);
  };

  const list = photos.data ?? [];

  return (
    <View style={{ gap: Spacing.sm }}>
      {photos.isLoading ? (
        <Text style={styles.muted}>Loading photos…</Text>
      ) : list.length === 0 ? (
        <Text style={styles.muted}>
          No photos yet. Guests are far more likely to book a listing with real photos — add at least 8.
        </Text>
      ) : (
        <View style={styles.grid}>
          {list.map((p) => (
            <View key={p.id} style={styles.tile}>
              {p.url ? <Image source={{ uri: p.url }} style={styles.thumb} /> : <View style={[styles.thumb, styles.thumbFallback]} />}
              {p.isCover ? (
                <View style={styles.coverBadge}>
                  <Star size={10} color="#FFFFFF" fill="#FFFFFF" />
                  <Text style={styles.coverText}>Cover</Text>
                </View>
              ) : (
                <Pressable style={styles.makeCoverBtn} onPress={() => setCover.mutate(p.id)} hitSlop={6}>
                  <Text style={styles.makeCoverText}>Set cover</Text>
                </Pressable>
              )}
              <Pressable style={styles.removeBtn} onPress={() => remove(p.id)} hitSlop={8} accessibilityLabel="Remove photo">
                <Trash2 size={13} color="#FFFFFF" />
              </Pressable>
            </View>
          ))}
          {Array.from({ length: uploadingCount }).map((_, i) => (
            <View key={`uploading-${i}`} style={[styles.tile, styles.thumbFallback, { alignItems: 'center', justifyContent: 'center' }]}>
              <ActivityIndicator size="small" color={Colors.primary} />
            </View>
          ))}
        </View>
      )}

      <View style={styles.addRow}>
        <Pressable style={styles.addBtn} onPress={() => pick(true)} accessibilityRole="button" accessibilityLabel="Take photo">
          <Camera size={18} color={Colors.primary} />
          <Text style={styles.addLabel}>Camera</Text>
        </Pressable>
        <Pressable style={styles.addBtn} onPress={() => pick(false)} accessibilityRole="button" accessibilityLabel="Choose from gallery">
          <ImagePlus size={18} color={Colors.primary} />
          <Text style={styles.addLabel}>Add from gallery</Text>
        </Pressable>
      </View>
    </View>
  );
}

const TILE = 104;

const styles = StyleSheet.create({
  muted: { color: Colors.onSurfaceVariant, fontSize: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tile: { width: TILE, height: TILE, borderRadius: Radius.md, overflow: 'hidden', backgroundColor: Colors.surfaceContainerHigh },
  thumb: { width: '100%', height: '100%' },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  coverBadge: {
    position: 'absolute', bottom: 4, left: 4, flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: 6, paddingVertical: 2,
  },
  coverText: { ...Typography.labelSm, color: '#FFFFFF', fontWeight: '700' as const, fontSize: 9 },
  makeCoverBtn: {
    position: 'absolute', bottom: 4, left: 4, backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: Radius.full, paddingHorizontal: 6, paddingVertical: 2,
  },
  makeCoverText: { ...Typography.labelSm, color: '#FFFFFF', fontSize: 9 },
  removeBtn: {
    position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  addRow: { flexDirection: 'row', gap: Spacing.sm },
  addBtn: {
    flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.outlineVariant, borderStyle: 'dashed', borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
  },
  addLabel: { ...Typography.labelSm, color: Colors.primary, fontWeight: '600' as const },
});
