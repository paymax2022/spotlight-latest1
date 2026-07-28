import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ArrowDown, ArrowUp, Minus, AlertTriangle } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { RESULT_FLAG_LABELS } from '@/features/doctor/constants';
import type { LabResultValueRich } from '@/types/doctor.batch3';

interface Props {
  value:   LabResultValueRich;
  divider?: boolean;
}

// New component: a structured lab result value row (test name + value/unit +
// reference range + normal/low/high flag + abnormal/critical emphasis). The
// Phase 1 lab screen had an inline flag block; this extracts the richer
// abnormal/critical-aware row so it can render reference ranges consistently.
const FLAG_ICON: Record<LabResultValueRich['base']['flag'], LucideIcon> = {
  normal: Minus,
  low:    ArrowDown,
  high:   ArrowUp,
};

export default function ResultValueRow({ value, divider }: Props) {
  const flag = value.base.flag;
  const Icon = value.critical ? AlertTriangle : FLAG_ICON[flag];
  const label = value.critical ? 'Critical' : RESULT_FLAG_LABELS[flag].label;
  const tone = value.critical
    ? { fg: Colors.error, bg: Colors.errorContainer }
    : value.abnormal
      ? { fg: Colors.secondary, bg: Colors.iconBgBlue }
      : { fg: Colors.teal, bg: Colors.iconBgTeal };

  return (
    <View style={[styles.row, divider && styles.divider]}>
      <View style={styles.body}>
        <Text style={[styles.name, value.critical && styles.nameCritical]} numberOfLines={2}>{value.base.testName}</Text>
        <Text style={styles.range}>Ref: {value.base.refRange}</Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.num}>{value.base.value} <Text style={styles.unit}>{value.base.unit}</Text></Text>
        <View style={[styles.flag, { backgroundColor: tone.bg }]}>
          <Icon size={11} color={tone.fg} strokeWidth={2.5} />
          <Text style={[styles.flagText, { color: tone.fg }]}>{label}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: Spacing.sm },
  divider:      { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  body:         { flex: 1, gap: 2 },
  name:         { ...Typography.labelLg, color: Colors.onSurface },
  nameCritical: { color: Colors.error },
  range:        { ...Typography.caption, color: Colors.onSurfaceVariant },
  right:        { alignItems: 'flex-end', gap: 4 },
  num:          { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' },
  unit:         { ...Typography.caption, color: Colors.onSurfaceVariant },
  flag:         { flexDirection: 'row', alignItems: 'center', gap: 3, height: 22, paddingHorizontal: 8, borderRadius: Radius.full },
  flagText:     { ...Typography.labelSm, fontWeight: '700' },
});
