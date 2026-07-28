import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { UploadCloud, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface Props {
  label: string;
  hint?: string;
  uploaded: boolean;
  onPress: () => void;
}

/** Document / selfie upload tile (KYC). Mock-uploads on tap; shows a check when done. */
export default function UploadTile({ label, hint, uploaded, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}${uploaded ? ', uploaded' : ', tap to upload'}`}
      style={({ pressed }) => [styles.tile, uploaded && styles.tileDone, pressed && styles.pressed]}
    >
      <View style={[styles.icon, uploaded && styles.iconDone]}>
        {uploaded
          ? <CheckCircle2 size={22} color={Colors.teal} strokeWidth={2} />
          : <UploadCloud size={22} color={Colors.secondary} strokeWidth={2} />}
      </View>
      <View style={styles.body}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.hint, uploaded && styles.hintDone]}>
          {uploaded ? 'Uploaded' : hint ?? 'Tap to upload'}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1.5, borderColor: Colors.outlineVariant, borderStyle: 'dashed', padding: Spacing.md,
  },
  tileDone: { borderColor: Colors.teal, borderStyle: 'solid', backgroundColor: Colors.surfaceContainerLow },
  pressed: { opacity: 0.85 },
  icon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  iconDone: { backgroundColor: Colors.iconBgTeal },
  body: { flex: 1 },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  hintDone: { color: Colors.teal },
});
