// ── "Your details" — read-only summary of what the account already knows ──────
// Rendered by a form INSTEAD of asking for these again. Only rows with a value
// appear; a detail the account lacks is left to the form to ask for.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

export interface AccountDetailRow {
  label: string;
  value: string;
}

export default function AccountDetailsCard({
  rows,
  title = 'Your details',
  note = 'Taken from your account. Update them in your profile if anything has changed.',
}: {
  rows: AccountDetailRow[];
  title?: string;
  note?: string;
}) {
  const shown = rows.filter((row) => Boolean(row.value));
  if (shown.length === 0) return null;

  return (
    <View style={styles.box}>
      <Text style={styles.title}>{title}</Text>
      {shown.map((row) => (
        <View key={row.label} style={styles.row}>
          <Text style={styles.label}>{row.label}</Text>
          <Text style={styles.value} numberOfLines={1}>{row.value}</Text>
        </View>
      ))}
      <Text style={styles.note}>{note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box:   { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg, gap: 8,
           marginBottom: Spacing.md },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  row:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.md },
  label: { ...Typography.caption, color: Colors.onSurfaceVariant },
  value: { ...Typography.bodyMd, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
  note:  { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },
});
