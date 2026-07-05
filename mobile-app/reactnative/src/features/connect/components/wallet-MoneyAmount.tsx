import React from 'react';
import { Text, StyleSheet, TextStyle } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { formatKobo } from '../constants/format';

interface Props {
  kobo: number | null | undefined;
  // 'credit' renders green w/ +, 'debit' red w/ −, undefined = neutral.
  direction?: 'credit' | 'debit';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  style?: TextStyle;
}

/**
 * Single render path for money. ALL amounts are kobo — formatNaira(kobo) lives
 * in format.ts (formatKobo). Never format money inline elsewhere.
 */
export function formatNaira(kobo: number | null | undefined): string {
  return formatKobo(kobo);
}

export default function MoneyAmount({ kobo, direction, size = 'md', style }: Props) {
  const sign = direction === 'credit' ? '+' : direction === 'debit' ? '−' : '';
  const color =
    direction === 'credit' ? Colors.teal : direction === 'debit' ? Colors.onSurface : Colors.onSurface;
  const sizeStyle =
    size === 'xl' ? styles.xl : size === 'lg' ? styles.lg : size === 'sm' ? styles.sm : styles.md;
  return (
    <Text style={[sizeStyle, { color }, style]}>
      {sign}{formatKobo(kobo)}
    </Text>
  );
}

const styles = StyleSheet.create({
  sm: { ...Typography.labelMd },
  md: { ...Typography.titleMd },
  lg: { ...Typography.titleLg },
  xl: { ...Typography.displayLg },
});
