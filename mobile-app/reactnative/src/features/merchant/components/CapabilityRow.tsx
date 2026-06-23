import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { StatusBadge } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';

interface Props {
  icon:      string;
  label:     string;
  sublabel:  string;
  statusLabel?: string;
  statusTone?:  StatusTone;
  active?:   boolean;       // currently-selected context
  onPress:   () => void;
}

// New component: a capabilities/switcher row (FR-25/FR-26) — icon, label,
// sublabel, an optional StatusBadge (reused) and an active-context ring.
// ProfileMenuItem has no status badge or active state and ModuleCard is a grid
// tile, so this list row is justified. Reuses StatusBadge for the pill.
export default function CapabilityRow({ icon, label, sublabel, statusLabel, statusTone = 'neutral', active, onPress }: Props) {
  const IconComponent = (Icons as unknown as Record<string, Icons.LucideIcon>)[icon] ?? Icons.UserRound;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, active && styles.rowActive, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      accessibilityLabel={`${label}, ${sublabel}${statusLabel ? `, ${statusLabel}` : ''}`}
    >
      <View style={[styles.iconBox, active && styles.iconBoxActive]}>
        <IconComponent size={20} color={active ? Colors.onPrimary : Colors.primary} strokeWidth={1.8} />
      </View>
      <View style={styles.body}>
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
        <Text style={styles.sublabel} numberOfLines={1}>{sublabel}</Text>
      </View>
      {statusLabel ? <StatusBadge label={statusLabel} tone={statusTone} /> : null}
      <ChevronRight size={16} color={Colors.outline} strokeWidth={1.8} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row:          { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest, marginBottom: Spacing.sm },
  rowActive:    { borderColor: Colors.primary, borderWidth: 1.5, backgroundColor: Colors.primaryFixed },
  pressed:      { opacity: 0.85 },
  iconBox:      { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  iconBoxActive:{ backgroundColor: Colors.primary },
  body:         { flex: 1, gap: 2 },
  label:        { ...Typography.labelLg, color: Colors.onSurface },
  sublabel:     { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
