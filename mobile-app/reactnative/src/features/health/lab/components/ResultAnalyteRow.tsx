import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { FLAG_META } from '../constants';
import type { ResultAnalyte } from '../types';

/** One analyte row in the secure results viewer: value, reference range, flag. */
export default function ResultAnalyteRow({ analyte }: { analyte: ResultAnalyte }) {
  const meta = FLAG_META[analyte.flag];
  const abnormal = analyte.flag !== 'normal';
  return (
    <View style={[styles.row, abnormal && styles.rowAbnormal]}>
      <View style={styles.left}>
        <Text style={styles.name} numberOfLines={1}>
          {analyte.name}
        </Text>
        <Text style={styles.ref}>Ref: {analyte.referenceRange} {analyte.unit}</Text>
      </View>
      <View style={styles.right}>
        <Text style={[styles.value, abnormal && { color: meta.color }]}>
          {analyte.value} {analyte.unit}
        </Text>
        <View style={[styles.flag, { backgroundColor: meta.bg }]}>
          <Text style={[styles.flagText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.sm + 2,
  },
  rowAbnormal: {},
  left: { flex: 1, marginRight: Spacing.sm },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  ref: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },
  right: { alignItems: 'flex-end', gap: 4 },
  value: { ...Typography.labelLg, color: Colors.onSurface },
  flag: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.full },
  flagText: { ...Typography.caption, fontWeight: '700' as const },
});
