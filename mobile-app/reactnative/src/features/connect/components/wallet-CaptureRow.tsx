import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface Props {
  icon: string;          // lucide name
  label: string;
  hint?: string;
  done?: boolean;        // a document/capture has been provided
  onPress: () => void;
}

/**
 * KYC document capture / upload affordance. In mock mode pressing it stubs a
 * captured URI (the real flow opens the camera / file picker). Shows a check
 * once provided.
 */
export default function CaptureRow({ icon, label, hint, done, onPress }: Props) {
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[icon] ?? Icons.Upload;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, done && styles.rowDone, pressed && styles.pressed]}>
      <View style={[styles.iconBox, done && styles.iconBoxDone]}>
        {done ? (
          <Check size={18} color={Colors.teal} strokeWidth={2.4} />
        ) : (
          <Icon size={18} color={Colors.primary} strokeWidth={2} />
        )}
      </View>
      <View style={styles.body}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{done ? 'Captured · tap to replace' : hint}</Text> : null}
      </View>
      <Text style={[styles.action, done && styles.actionDone]}>{done ? 'Done' : 'Add'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  rowDone: { borderColor: Colors.teal },
  pressed: { opacity: 0.7 },
  iconBox: {
    width: 40, height: 40, borderRadius: Radius.full,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center', justifyContent: 'center',
  },
  iconBoxDone: { backgroundColor: Colors.iconBgTeal },
  body: { flex: 1 },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  action: { ...Typography.labelMd, color: Colors.primary },
  actionDone: { color: Colors.teal },
});
