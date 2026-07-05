import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { ORDER_STATUS_META } from '../constants';
import type { LabOrderStatus } from '../types';

/** Order-status pill, design-token coloured. Critical → ESCALATED reads red (HL-7). */
export default function LabStatusPill({ status }: { status: LabOrderStatus }) {
  const meta = ORDER_STATUS_META[status];
  return (
    <View style={[styles.pill, { backgroundColor: meta.bg }]} accessibilityRole="text">
      <Text style={[styles.text, { color: meta.color }]} numberOfLines={1}>
        {meta.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  text: { ...Typography.labelSm, fontWeight: '700' as const },
});
