import React from 'react';
import { View, Text, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';

interface Props {
  title:        string;
  actionLabel?: string;
  onAction?:    () => void;
  style?:       ViewStyle;
}

export default function SectionHeader({ title, actionLabel, onAction, style }: Props) {
  return (
    <View style={[styles.row, style]}>
      <Text style={styles.title}>{title}</Text>
      {actionLabel && (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={styles.action}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection:   'row',
    justifyContent:  'space-between',
    alignItems:      'center',
    paddingHorizontal: Spacing.containerMargin,
    marginBottom:    Spacing.sm,
  },
  title: {
    ...Typography.titleMd,
    color: Colors.onSurface,
  },
  action: {
    ...Typography.labelMd,
    color: Colors.secondary,
  },
});
