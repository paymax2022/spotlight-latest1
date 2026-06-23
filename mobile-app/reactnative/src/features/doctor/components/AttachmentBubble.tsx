import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { FileText, MapPin } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  kind:          'image' | 'document';
  uri:           string;
  name:          string;
  caption?:      string;
  mimeType?:     string;
  annotationCount?: number;       // pins placed on the image (annotate flow)
  mine?:         boolean;
  onPress?:      () => void;      // open viewer / annotate sheet
}

// New component: an inline image thumbnail / document tile rendered inside a
// chat bubble. MessageBubble only renders text + a plain attachment name (no
// thumbnail preview, no document tile, no annotation badge), so a dedicated
// attachment preview is justified. Reused for both image and document kinds.
export default function AttachmentBubble({ kind, uri, name, caption, mimeType, annotationCount = 0, mine = false, onPress }: Props) {
  if (kind === 'image') {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={caption ?? 'View image'} style={styles.imageWrap}>
        <Image source={{ uri }} style={styles.image} resizeMode="cover" />
        {annotationCount > 0 && (
          <View style={styles.pinBadge}>
            <MapPin size={11} color={Colors.onPrimary} strokeWidth={2.4} />
            <Text style={styles.pinText}>{annotationCount}</Text>
          </View>
        )}
        {!!caption && <Text style={[styles.caption, mine && styles.captionMine]} numberOfLines={2}>{caption}</Text>}
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Open ${name}`} style={[styles.docRow, mine ? styles.docRowMine : styles.docRowTheirs]}>
      <View style={[styles.docIcon, mine ? styles.docIconMine : styles.docIconTheirs]}>
        <FileText size={18} color={mine ? Colors.onPrimary : Colors.primary} strokeWidth={2} />
      </View>
      <View style={styles.docBody}>
        <Text style={[styles.docName, mine && styles.captionMine]} numberOfLines={1}>{name}</Text>
        {!!mimeType && <Text style={[styles.docMeta, mine && styles.metaMine]} numberOfLines={1}>{mimeType}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  imageWrap:   { width: 200, gap: Spacing.xs },
  image:       { width: 200, height: 150, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh },
  pinBadge:    { position: 'absolute', top: Spacing.xs, right: Spacing.xs, flexDirection: 'row', alignItems: 'center', gap: 2, height: 22, paddingHorizontal: 6, borderRadius: Radius.full, backgroundColor: Colors.primary },
  pinText:     { ...Typography.caption, color: Colors.onPrimary, fontWeight: '700' },
  caption:     { ...Typography.bodySm, color: Colors.onSurface },
  captionMine: { color: Colors.onPrimary },
  metaMine:    { color: 'rgba(255,255,255,0.75)' },
  docRow:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minWidth: 200, padding: Spacing.sm, borderRadius: Radius.md },
  docRowMine:  { backgroundColor: 'rgba(255,255,255,0.14)' },
  docRowTheirs:{ backgroundColor: Colors.surfaceContainerLow },
  docIcon:     { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  docIconMine: { backgroundColor: 'rgba(255,255,255,0.2)' },
  docIconTheirs:{ backgroundColor: Colors.iconBgPurple },
  docBody:     { flex: 1, gap: 2 },
  docName:     { ...Typography.labelMd, color: Colors.onSurface },
  docMeta:     { ...Typography.caption, color: Colors.onSurfaceVariant },
});
