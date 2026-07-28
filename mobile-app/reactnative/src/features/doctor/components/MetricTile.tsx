import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  icon:  LucideIcon;
  label: string;
  value: string;
  hint?: string;                 // optional sub-line (e.g. peer comparison)
  color?: string;                // icon tint token
  bg?:    string;                // icon background token
}

// New component (Z): a reputation metric tile (icon + value + label + optional
// hint). StatCard renders icon/value/label but has no hint sub-line and uses a
// shadow card; the rating dashboard needs a flat tile with an optional hint
// (peer median / weight), so this mirrors the existing inline `Metric` helper
// in reviews/index.tsx as a reusable component.
export default function MetricTile({ icon: Icon, label, value, hint, color = Colors.primary, bg = Colors.iconBgPurple }: Props) {
  return (
    <View style={styles.tile}>
      <View style={[styles.iconBox, { backgroundColor: bg }]}>
        <Icon size={18} color={color} strokeWidth={2} />
      </View>
      <Text style={styles.value} numberOfLines={1}>{value}</Text>
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
      {!!hint && <Text style={styles.hint} numberOfLines={1}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  tile:    { flex: 1, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  iconBox: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  value:   { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' },
  label:   { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  hint:    { ...Typography.caption, color: Colors.onSurfaceVariant },
});
