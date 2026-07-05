import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import type { GlossaryTerm } from '../types/learn.types';

interface Props {
  entry: GlossaryTerm;
}

/** Definition-list row for the searchable glossary. */
export default function GlossaryRow({ entry }: Props) {
  return (
    <View style={styles.row} accessibilityRole="text" accessibilityLabel={`${entry.term}: ${entry.definition}`}>
      <Text style={styles.term}>{entry.term}</Text>
      <Text style={styles.definition}>{entry.definition}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: Spacing.sm + 2, gap: 3 },
  term: { ...Typography.labelLg, color: Colors.onSurface },
  definition: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
});
