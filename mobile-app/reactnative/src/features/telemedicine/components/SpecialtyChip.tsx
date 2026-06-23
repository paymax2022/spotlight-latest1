import React from 'react';
import { Text, Pressable, StyleSheet, View } from 'react-native';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import type { Specialty } from '@/types/telemedicine';

interface Props {
  specialty: Specialty;
  active?:   boolean;
  onPress?:  () => void;
  variant?:  'tile' | 'chip';
}

export default function SpecialtyChip({ specialty, active, onPress, variant = 'tile' }: Props) {
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[specialty.icon] ?? Icons.Stethoscope;

  if (variant === 'chip') {
    return (
      <Pressable
        onPress={onPress}
        style={[styles.chip, active ? styles.chipActive : null]}
      >
        <Icon size={15} color={active ? Colors.onPrimary : specialty.accent} strokeWidth={2} />
        <Text style={[styles.chipLabel, active ? styles.chipLabelActive : null]}>{specialty.name}</Text>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onPress} style={[styles.tile, active ? styles.tileActive : null]}>
      <View style={[styles.iconBox, { backgroundColor: specialty.bg }]}>
        <Icon size={24} color={specialty.accent} strokeWidth={1.9} />
      </View>
      <Text style={styles.tileLabel} numberOfLines={1}>{specialty.name}</Text>
      <Text style={styles.tileCount}>{specialty.doctorCount} doctors</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile:       { width: '31%', alignItems: 'center', gap: 6, paddingVertical: Spacing.md, paddingHorizontal: Spacing.sm, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  tileActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  iconBox:    { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  tileLabel:  { ...Typography.labelMd, color: Colors.onSurface, textAlign: 'center' },
  tileCount:  { ...Typography.caption, color: Colors.onSurfaceVariant },
  chip:       { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: Spacing.md, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipLabel:  { ...Typography.labelMd, color: Colors.onSurface },
  chipLabelActive: { color: Colors.onPrimary },
});
