// ── Paymax · Admin — ListCard ────────────────────────────────────────────────
// Card wrapper used to compose tables/lists. An optional title renders a small
// header row; children are the rows (e.g. DataRow). Level-1 elevation card.

import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { shadow1 } from '@/constants/shadows';

interface Props {
  title?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
  style?: ViewStyle;
  /** Remove inner padding so rows can manage their own (table-style). */
  flush?: boolean;
}

export default function ListCard({ title, footer, children, style, flush }: Props) {
  return (
    <View style={[styles.card, style]}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <View style={!flush && styles.body}>{children}</View>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    marginHorizontal: Spacing.containerMargin,
    paddingVertical: Spacing.sm,
    ...shadow1,
  },
  title: {
    ...Typography.labelMd,
    color: Colors.onSurfaceVariant,
    paddingHorizontal: Spacing.cardPadding,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  body: { paddingHorizontal: 0 },
  footer: {
    paddingHorizontal: Spacing.cardPadding,
    paddingTop: Spacing.sm,
  },
});
