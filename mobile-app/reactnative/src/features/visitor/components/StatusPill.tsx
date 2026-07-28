import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { CODE_STATUS_LABELS, STATUS_STYLE } from '../constants/visitor.constants';
import type { AccessCodeStatus } from '../types/visitor.types';

/** Small pill-shaped status chip (PRD §components: status chips). */
export default function StatusPill({ status }: { status: AccessCodeStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <View style={[styles.pill, { backgroundColor: s.bg }]}>
      <View style={[styles.dot, { backgroundColor: s.color }]} />
      <Text style={[styles.label, { color: s.color }]}>{CODE_STATUS_LABELS[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
    alignSelf: 'flex-start',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { ...Typography.labelSm, fontWeight: '700' },
});
