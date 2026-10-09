import React from 'react';
import { ScrollView, View, Text, Image, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { X, Camera } from 'lucide-react-native';
import { ChevronUp, ChevronDown } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { alertAsync, confirmAsync } from '@/lib/confirm';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import {
  usePhotos,
  useAddPhoto,
  useReorderPhotos,
  useRemovePhoto,
} from '@/features/connect/profile/hooks';

const MAX_PHOTOS = 9;

// PR — Photo management. The first photo is the primary. New photos are uploaded
// to storage and reviewed before they are shown to other people.
export default function ProfilePhotos() {
  const { data: photos, isLoading, error, refetch } = usePhotos();
  const add = useAddPhoto();
  const reorder = useReorderPhotos();
  const remove = useRemovePhoto();

  const busy = add.isPending || reorder.isPending || remove.isPending;
  const full = (photos?.length ?? 0) >= MAX_PHOTOS;

  const move = (from: number, to: number) => {
    if (!photos || to < 0 || to >= photos.length) return;
    const next = [...photos];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    reorder.mutate(next.map((p) => p.id));
  };

  const onRemove = async (id: string) => {
    const ok = await confirmAsync({
      title: 'Remove this photo?',
      message: 'It will be taken off your profile.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (ok) remove.mutate(id);
  };

  const onAdd = async () => {
    if (busy || full) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        await alertAsync({ title: 'Photo access needed', message: 'Allow photo library access to add photos.' });
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [4, 5],
        quality: 0.8,
      });
      const asset = !res.canceled ? res.assets?.[0] : undefined;
      if (!asset?.uri) return;
      add.mutate(
        { uri: asset.uri, mime: asset.mimeType },
        {
          onError: (e) =>
            void alertAsync({
              title: "Couldn't add photo",
              message: e instanceof Error ? e.message : 'Please try again.',
            }),
        },
      );
    } catch {
      await alertAsync({ title: "Couldn't open your photos", message: 'Please try again.' });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Photos" subtitle="Your profile" />

      {isLoading ? (
        <StateView kind="loading" message="Loading photos…" />
      ) : error || !photos ? (
        <StateView
          kind="error"
          title="Couldn't load photos"
          icon="ImageOff"
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      ) : photos.length === 0 ? (
        <StateView
          kind="empty"
          title="No photos yet"
          message="Add photos so people can see the real you."
          icon="ImagePlus"
          actionLabel={add.isPending ? 'Uploading…' : 'Add photo'}
          onAction={onAdd}
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          <Text style={styles.hint}>
            The first photo is your primary. Use the arrows to reorder. New photos show a
            “In review” tag until they are approved.
          </Text>

          <View style={styles.grid}>
            {photos.map((photo, i) => (
              <View key={photo.id} style={styles.tile}>
                <Image source={{ uri: photo.url }} style={styles.image} resizeMode="cover" />

                {i === 0 ? (
                  <View style={styles.primaryTag}>
                    <Text style={styles.primaryTagText}>Primary</Text>
                  </View>
                ) : photo.status === 'pending' ? (
                  <View style={[styles.primaryTag, styles.reviewTag]}>
                    <Text style={styles.primaryTagText}>In review</Text>
                  </View>
                ) : null}

                <Pressable
                  style={styles.removeBtn}
                  hitSlop={6}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo"
                  onPress={() => onRemove(photo.id)}
                >
                  <X size={16} color={Colors.white} strokeWidth={2.4} />
                </Pressable>

                <View style={styles.reorderBar}>
                  <Pressable
                    style={[styles.reorderBtn, i === 0 && styles.reorderDisabled]}
                    disabled={busy || i === 0}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="Move up"
                    onPress={() => move(i, i - 1)}
                  >
                    <ChevronUp size={16} color={Colors.white} strokeWidth={2.4} />
                  </Pressable>
                  <Pressable
                    style={[styles.reorderBtn, i === photos.length - 1 && styles.reorderDisabled]}
                    disabled={busy || i === photos.length - 1}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="Move down"
                    onPress={() => move(i, i + 1)}
                  >
                    <ChevronDown size={16} color={Colors.white} strokeWidth={2.4} />
                  </Pressable>
                </View>
              </View>
            ))}

            {!full ? (
              <Pressable
                style={styles.addTile}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Add photo"
                onPress={onAdd}
              >
                {add.isPending ? (
                  <ActivityIndicator color={ConnectColors.brand} />
                ) : (
                  <>
                    <Camera size={26} color={ConnectColors.brand} strokeWidth={2} />
                    <Text style={styles.addText}>Add photo</Text>
                  </>
                )}
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60 },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginVertical: Spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tile: {
    width: '48%',
    aspectRatio: 3 / 4,
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceContainerHigh,
  },
  image: { width: '100%', height: '100%' },
  primaryTag: {
    position: 'absolute',
    top: Spacing.xs,
    left: Spacing.xs,
    backgroundColor: ConnectColors.brand,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  reviewTag: { backgroundColor: Colors.backdropDark },
  primaryTagText: { ...Typography.caption, color: Colors.white, fontWeight: '700' },
  removeBtn: {
    position: 'absolute',
    top: Spacing.xs,
    right: Spacing.xs,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.backdropDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reorderBar: {
    position: 'absolute',
    bottom: Spacing.xs,
    right: Spacing.xs,
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  reorderBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.backdropDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reorderDisabled: { opacity: 0.35 },
  addTile: {
    width: '48%',
    aspectRatio: 3 / 4,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: ConnectColors.border,
    backgroundColor: Colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  addText: { ...Typography.labelMd, color: ConnectColors.brand, fontWeight: '600' },
});
