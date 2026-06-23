import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';

interface Props {
  label:   string;
  value:   string;
  valueColor?: string;
}

// New component: a compact label/value pair used across patient profile, HMO
// eligibility and payout detail rows. No shared key/value row component exists.
export default function InfoRow({ label, value, valueColor }: Props) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, !!valueColor && { color: valueColor }]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: Spacing.sm },
  label: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, flexShrink: 0 },
  value: { ...Typography.labelMd, color: Colors.onSurface, flex: 1, textAlign: 'right' },
});
