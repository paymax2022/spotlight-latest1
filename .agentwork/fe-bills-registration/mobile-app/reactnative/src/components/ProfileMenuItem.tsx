import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface Props {
  icon:       string;
  iconColor?: string;
  bgColor?:   string;
  label:      string;
  value?:     string;
  danger?:    boolean;
  onPress:    () => void;
  showChevron?: boolean;
}

export default function ProfileMenuItem({ icon, iconColor, bgColor, label, value, danger, onPress, showChevron = true }: Props) {
  const IconComponent = (Icons as unknown as Record<string, Icons.LucideIcon>)[icon] ?? Icons.Circle;
  const color = danger ? Colors.error : (iconColor ?? Colors.primary);
  const bg    = bgColor ?? (danger ? Colors.errorContainer : Colors.iconBgPurple);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={[styles.iconBox, { backgroundColor: bg }]}>
        <IconComponent size={20} color={color} strokeWidth={1.8} />
      </View>
      <Text style={[styles.label, danger && styles.danger]}>{label}</Text>
      {value && <Text style={styles.value}>{value}</Text>}
      {showChevron && <ChevronRight size={16} color={Colors.outline} strokeWidth={1.8} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection:   'row',
    alignItems:      'center',
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.containerMargin,
    gap:             Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  pressed: { backgroundColor: Colors.surfaceContainerLow },
  iconBox: {
    width:          40,
    height:         40,
    borderRadius:   Radius.md,
    alignItems:     'center',
    justifyContent: 'center',
  },
  label: {
    ...Typography.bodyMd,
    color: Colors.onSurface,
    flex:  1,
  },
  danger: { color: Colors.error },
  value: {
    ...Typography.labelSm,
    color: Colors.onSurfaceVariant,
  },
});
