import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';

interface Props {
  label: string;
  value: string;
  emphasis?: boolean;     // bold value (e.g. total)
  refundable?: boolean;   // appends a teal "refundable" note
}

/** Label↔value row used in fee breakdowns, summaries and review screens. */
export default function DetailRow({ label, value, emphasis, refundable }: Props) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, emphasis && styles.labelEmph]}>{label}</Text>
      <View style={styles.right}>
        <Text style={[styles.value, emphasis && styles.valueEmph]}>{value}</Text>
        {refundable ? <Text style={styles.refund}>Refundable</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: Spacing.sm,
    gap: Spacing.md,
  },
  label: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, flex: 1 },
  labelEmph: { color: Colors.onSurface, fontWeight: '700' as const },
  right: { alignItems: 'flex-end' },
  value: { ...Typography.bodyMd, color: Colors.onSurface, fontWeight: '600' as const },
  valueEmph: { ...Typography.titleMd, color: Colors.primary },
  refund: { ...Typography.labelSm, color: Colors.teal, marginTop: 2 },
});
