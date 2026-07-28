import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Image, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImagePlus, FileText, Camera, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { InsuranceColors } from '../constants/insurance.constants';
import type { ClaimEvidence } from '../claims';

/**
 * Evidence / inspection uploader (PRD §15.1 evidence upload + §15.3 inspection
 * upload). Image picker + signed-URL placeholder. Reused by the customer claims
 * evidence screen and the partner inspection screen.
 */
export default function EvidencePicker({
  evidence,
  uploading,
  onPick,
  kindLabel = 'photo',
}: {
  evidence: ClaimEvidence[];
  uploading: boolean;
  onPick: (file: { label: string; uri: string; kind: ClaimEvidence['kind'] }) => void;
  kindLabel?: string;
}) {
  const [busy, setBusy] = useState(false);

  const pickImage = async (fromCamera: boolean) => {
    try {
      setBusy(true);
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', `Allow access to your ${fromCamera ? 'camera' : 'photos'} to add evidence.`);
        return;
      }
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        const name = asset.fileName ?? `${kindLabel}-${Date.now()}.jpg`;
        onPick({ label: name, uri: asset.uri, kind: kindLabel === 'inspection' ? 'inspection' : 'photo' });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.actions}>
        <Pressable style={styles.action} onPress={() => pickImage(true)} disabled={busy || uploading} accessibilityRole="button" accessibilityLabel="Take a photo">
          <Camera size={20} color={InsuranceColors.brand} />
          <Text style={styles.actionLabel}>Take photo</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={() => pickImage(false)} disabled={busy || uploading} accessibilityRole="button" accessibilityLabel="Choose from library">
          <ImagePlus size={20} color={InsuranceColors.brand} />
          <Text style={styles.actionLabel}>Choose photo</Text>
        </Pressable>
      </View>

      {uploading ? <Text style={styles.note}>Uploading via secure link…</Text> : null}

      {evidence.length > 0 ? (
        <View style={styles.list}>
          {evidence.map((e) => (
            <View key={e.id} style={styles.item}>
              {e.kind !== 'document' && e.uri.startsWith('file') ? (
                <Image source={{ uri: e.uri }} style={styles.thumb} />
              ) : (
                <View style={styles.thumbIcon}><FileText size={18} color={InsuranceColors.muted} /></View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.itemLabel} numberOfLines={1}>{e.label}</Text>
                <Text style={styles.itemMeta}>{e.kind} · uploaded</Text>
              </View>
              <CircleCheck size={18} color={InsuranceColors.ok} />
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>No evidence yet. Photos help speed up assessment.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.md },
  actions: { flexDirection: 'row', gap: Spacing.md },
  action: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
    backgroundColor: InsuranceColors.surfaceAlt, borderRadius: Radius.md, paddingVertical: Spacing.md,
    borderWidth: 1, borderColor: InsuranceColors.border,
  },
  actionLabel: { ...Typography.labelLg, color: InsuranceColors.text },
  note: { ...Typography.labelSm, color: InsuranceColors.muted },
  empty: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  list: { gap: Spacing.sm },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: InsuranceColors.surface, borderRadius: Radius.md, padding: Spacing.sm,
    borderWidth: 1, borderColor: InsuranceColors.border,
  },
  thumb: { width: 40, height: 40, borderRadius: Radius.sm },
  thumbIcon: { width: 40, height: 40, borderRadius: Radius.sm, backgroundColor: InsuranceColors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  itemLabel: { ...Typography.labelLg, color: Colors.onSurface },
  itemMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2, textTransform: 'capitalize' },
});
