// ── Paymax · Admin — DataRow ─────────────────────────────────────────────────
// Generic left-label + right-value/badge row, used to compose tables inside a
// ListCard. The right side can be a string (rendered as a value) or any node
// (badge, toggle, button). Optionally pressable for drill-down navigation.

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';

interface Props {
  label: string;
  sublabel?: string;
  value?: string;
  right?: React.ReactNode; // overrides `value` when provided
  onPress?: () => void;
  showChevron?: boolean;
  /** Drop the bottom hairline (e.g. last row in a card). */
  last?: boolean;
}

export default function DataRow({ label, sublabel, value, right, onPress, showChevron, last }: Props) {
  const body = (
    <View style={[styles.row, !last && styles.border]}>
      <View style={styles.left}>
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
        {sublabel ? <Text style={styles.sublabel} numberOfLines={1}>{sublabel}</Text> : null}
      </View>
      <View style={styles.right}>
        {right ?? (value ? <Text style={styles.value} numberOfLines={1}>{value}</Text> : null)}
        {showChevron ? <ChevronRight size={18} color={Colors.outline} /> : null}
      </View>
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
        {body}
      </Pressable>
    );
  }
  return body;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.cardPadding,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.outlineVariant },
  left: { flex: 1, gap: 2 },
  label: { ...Typography.bodyMd, color: Colors.onSurface },
  sublabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  right: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, maxWidth: '55%', justifyContent: 'flex-end' },
  value: { ...Typography.labelMd, color: Colors.onSurface },
  pressed: { opacity: 0.6 },
});
