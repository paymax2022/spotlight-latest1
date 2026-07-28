import React, { useState } from 'react';
import { Pressable, View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Upload, CircleCheck, Camera } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface Props {
  label: string;
  hint?: string;
  uploaded: boolean;
  onUploaded: () => void;
  icon?: 'document' | 'camera';
}

/**
 * Mock document-upload placeholder. No real file picker — tapping simulates an
 * upload (short spinner) then marks the tile done and calls onUploaded so the
 * parent can persist the boolean flag on the KYC draft.
 */
export default function UploadTile({ label, hint, uploaded, onUploaded, icon = 'document' }: Props) {
  const [busy, setBusy] = useState(false);

  const onPress = () => {
    if (uploaded || busy) return;
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      onUploaded();
    }, 1100);
  };

  const Glyph = icon === 'camera' ? Camera : Upload;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: uploaded }}
      style={[styles.tile, uploaded && styles.tileDone]}
    >
      <View style={[styles.iconBox, uploaded && styles.iconBoxDone]}>
        {busy ? (
          <ActivityIndicator color={Colors.primary} />
        ) : uploaded ? (
          <CircleCheck size={24} color={Colors.tertiaryContainer} strokeWidth={2} />
        ) : (
          <Glyph size={24} color={Colors.primary} strokeWidth={1.8} />
        )}
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.hint}>
          {busy ? 'Uploading…' : uploaded ? 'Uploaded' : hint ?? 'Tap to upload'}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
  },
  tileDone: { borderStyle: 'solid', borderColor: Colors.teal, backgroundColor: Colors.surfaceContainerLow },
  iconBox: {
    width: 48, height: 48, borderRadius: Radius.md,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center', justifyContent: 'center',
  },
  iconBoxDone: { backgroundColor: Colors.iconBgTeal },
  textWrap: { flex: 1 },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
});
