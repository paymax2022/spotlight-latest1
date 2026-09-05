// ── Sell — reorderable photo strip (Smart Composer, screen 11) ───────────────
// The first photo is the cover. Reordering is done with explicit controls
// (make-cover + left/right nudge + remove) rather than a native drag gesture, so
// it works reliably on Expo web and native without a drag-drop dependency. The
// cover slot is badged, matching the spec's "drag-to-front for cover photo".
import React from 'react';
import { View, Text, StyleSheet, Pressable, Image, ScrollView, ActivityIndicator } from 'react-native';
import { X, Star, ChevronLeft, ChevronRight, Camera, ImagePlus } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { MarketColors } from '@/features/marketplace';

export interface ComposerPhoto {
  id: string;
  uri: string;
  /** perceptual-hash stand-in used for the client-side duplicate warning. */
  phash: string;
  /** true while the presign→PUT upload is in flight. */
  uploading?: boolean;
  /** the durable fileUrl once uploaded (persisted as the listing mediaId). */
  fileUrl?: string;
  /** the picked asset's real MIME type (ImagePicker's a.mimeType) — a camera
   *  capture or gallery pick is not always a JPEG (screenshots and some Android
   *  gallery sources are PNG). Upload must presign/PUT/name the object with the
   *  ACTUAL type, or the stored bytes and the declared type disagree and native
   *  Image decoders (which trust the extension/Content-Type, unlike browsers)
   *  fail to render it. */
  mimeType?: string;
}

/** Maps a picked asset's real mime type to a file extension for the upload's
 *  object key. Mirrors the backend's listingMediaContentTypes allow-list exactly
 *  (backend/internal/marketplace/presign.go: png, jpeg, webp only) — anything
 *  else (e.g. iOS HEIC) falls back to jpg here, but presign itself is the
 *  authority and will 400 on a genuinely unsupported mime_type. */
export function extensionForMime(mime?: string): string {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/jpeg':
    default:
      return 'jpg';
  }
}

interface Props {
  photos: ComposerPhoto[];
  onReorder: (next: ComposerPhoto[]) => void;
  onRemove: (id: string) => void;
  onAddCamera: () => void;
  onAddGallery: () => void;
  maxPhotos?: number;
}

export default function PhotoStrip({ photos, onReorder, onRemove, onAddCamera, onAddGallery, maxPhotos = 10 }: Props) {
  const move = (from: number, to: number) => {
    if (to < 0 || to >= photos.length) return;
    const next = photos.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onReorder(next);
  };
  const makeCover = (index: number) => move(index, 0);
  const canAdd = photos.length < maxPhotos;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {photos.map((p, i) => (
        <View key={p.id} style={styles.thumbCol}>
          <View style={styles.thumbWrap}>
            <Image source={{ uri: p.uri }} style={styles.thumb} />
            {i === 0 ? (
              <View style={styles.coverBadge}>
                <Star size={10} color="#FFFFFF" fill="#FFFFFF" />
                <Text style={styles.coverText}>Cover</Text>
              </View>
            ) : null}
            {p.uploading ? (
              <View style={styles.uploadingOverlay}>
                <ActivityIndicator size="small" color="#FFFFFF" />
              </View>
            ) : null}
            <Pressable style={styles.removeBtn} onPress={() => onRemove(p.id)} hitSlop={8} accessibilityLabel="Remove photo">
              <X size={12} color="#FFFFFF" />
            </Pressable>
          </View>
          <View style={styles.controls}>
            <Pressable onPress={() => move(i, i - 1)} disabled={i === 0} hitSlop={6} accessibilityLabel="Move photo left">
              <ChevronLeft size={16} color={i === 0 ? MarketColors.border : MarketColors.muted} />
            </Pressable>
            {i !== 0 ? (
              <Pressable onPress={() => makeCover(i)} hitSlop={6} accessibilityLabel="Make cover photo">
                <Text style={styles.makeCover}>Cover</Text>
              </Pressable>
            ) : (
              <Text style={styles.coverHint}>Cover</Text>
            )}
            <Pressable onPress={() => move(i, i + 1)} disabled={i === photos.length - 1} hitSlop={6} accessibilityLabel="Move photo right">
              <ChevronRight size={16} color={i === photos.length - 1 ? MarketColors.border : MarketColors.muted} />
            </Pressable>
          </View>
        </View>
      ))}

      {canAdd ? (
        <View style={styles.addCol}>
          <Pressable style={styles.addBtn} onPress={onAddCamera} accessibilityRole="button" accessibilityLabel="Take photo">
            <Camera size={22} color={MarketColors.brand} />
            <Text style={styles.addLabel}>Camera</Text>
          </Pressable>
          <Pressable style={styles.addBtn} onPress={onAddGallery} accessibilityRole="button" accessibilityLabel="Choose from gallery">
            <ImagePlus size={22} color={MarketColors.brand} />
            <Text style={styles.addLabel}>Gallery</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

const THUMB = 84;

const styles = StyleSheet.create({
  strip: { gap: Spacing.sm, paddingVertical: Spacing.xs },
  thumbCol: { width: THUMB, gap: 4 },
  thumbWrap: { width: THUMB, height: THUMB, borderRadius: Radius.md, overflow: 'hidden', backgroundColor: MarketColors.surfaceAlt },
  thumb: { width: '100%', height: '100%' },
  coverBadge: { position: 'absolute', bottom: 4, left: 4, flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: MarketColors.brand, borderRadius: Radius.full, paddingHorizontal: 6, paddingVertical: 2 },
  coverText: { ...Typography.labelSm, color: '#FFFFFF', fontWeight: '700', fontSize: 9 },
  uploadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(11,28,48,0.45)', alignItems: 'center', justifyContent: 'center' },
  removeBtn: { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(11,28,48,0.7)', alignItems: 'center', justifyContent: 'center' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  makeCover: { ...Typography.labelSm, color: MarketColors.brand, fontWeight: '700', fontSize: 10 },
  coverHint: { ...Typography.labelSm, color: MarketColors.muted, fontSize: 10 },
  addCol: { gap: Spacing.xs },
  addBtn: { width: THUMB, height: (THUMB - Spacing.xs) / 2, borderRadius: Radius.md, borderWidth: 1.5, borderColor: MarketColors.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4 },
  addLabel: { ...Typography.labelSm, color: MarketColors.brand, fontSize: 10 },
});
