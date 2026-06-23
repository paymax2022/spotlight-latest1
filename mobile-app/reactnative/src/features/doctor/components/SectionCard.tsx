import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  title?:    string;
  children:  React.ReactNode;
  style?:    ViewStyle;
}

// New component: a titled surface card wrapper used to group content blocks on
// the doctor detail screens. Keeps padding/border tokens consistent across
// screens without duplicating the same card StyleSheet everywhere.
export default function SectionCard({ title, children, style }: Props) {
  return (
    <View style={[styles.card, style]}>
      {!!title && <Text style={styles.title}>{title}</Text>}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card:  { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  title: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
});
