import React from 'react';
import { ScrollView, View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { X, Camera } from 'lucide-react-native';
import { ChevronUp, ChevronDown } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { PLACEHOLDER_PHOTOS } from '@/features/connect/profile/api';
import {
  usePhotos,
  useReorderPhotos,
  useRemovePhoto,
} from '@/features/connect/profile/hooks';
import type { ConnectMode } from '@/features/connect/profile/types';

// PR — Per-mode photo management. Photos belong to ONE mode only and are never
// shared with the other mode. Index 0 is the primary photo.
export default function ProfilePhotos() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode: ConnectMode = params.mode === 'network' ? 'network' : 'date';
  const modeLabel = mode === 'date' ? 'Date' : 'Network';

  const { data: photos, isLoading, error, refetch } = usePhotos(mode);
  const reorder = useReorderPhotos();
  const remove = useRemovePhoto();

  const busy = reorder.isPending || remove.isPending;

  const move = (from: number, to: number) => {
    if (!photos || to < 0 || to >= photos.length) return;
    const next = [...photos];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    reorder.mutate({ mode, photos: next });
  };

  const onRemove = (uri: string) => remove.mutate({ mode, uri });

  const onAdd = () => {
    if (!photos) return;
    // Mock: append the first placeholder not already present.
    const next = PLACEHOLDER_PHOTOS.find((p) => !photos.includes(p));
    if (!next) return;
    reorder.mutate({ mode, photos: [...photos, next] });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Photos" subtitle={`${modeLabel} profile`} />

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
          message={`Add photos to your ${modeLabel} profile so people can see the real you.`}
          icon="ImagePlus"
          actionLabel="Add photo"
          onAction={onAdd}
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          <Text style={styles.hint}>
            The first photo is your primary. Use the arrows to reorder.
          </Text>

          <View style={styles.grid}>
            {photos.map((uri, i) => (
              <View key={`${uri}-${i}`} style={styles.tile}>
                <Image source={{ uri }} style={styles.image} resizeMode="cover" />

                {i === 0 ? (
                  <View style={styles.primaryTag}>
                    <Text style={styles.primaryTagText}>Primary</Text>
                  </View>
                ) : null}

                <Pressable
                  style={styles.removeBtn}
                  hitSlop={6}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo"
                  onPress={() => onRemove(uri)}
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

            <Pressable
              style={styles.addTile}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Add photo"
              onPress={onAdd}
            >
              <Camera size={26} color={ConnectColors.brand} strokeWidth={2} />
              <Text style={styles.addText}>Add photo</Text>
            </Pressable>
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
