import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { POLICY_STATE_LABEL } from '../constants/insurance.constants';
import type { PolicyState } from '../types';

const TONE: Record<PolicyState, { fg: string; bg: string }> = {
  ACTIVE:          { fg: Colors.teal,      bg: Colors.iconBgTeal },
  QUOTED:          { fg: Colors.secondary, bg: Colors.iconBgBlue },
  PENDING_PAYMENT: { fg: Colors.secondary, bg: Colors.iconBgBlue },
  BINDING:         { fg: Colors.secondary, bg: Colors.iconBgBlue },
  RENEWAL_DUE:     { fg: Colors.onWarning, bg: Colors.iconBgGold },
  LAPSED:          { fg: Colors.onWarning, bg: Colors.iconBgGold },
  EXPIRED:         { fg: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
  CANCELLED:       { fg: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
  BIND_FAILED:     { fg: Colors.error,     bg: Colors.errorContainer },
  VOID:            { fg: Colors.error,     bg: Colors.errorContainer },
};

/** Policy-state pill (reused across policy list/detail and by IM2). */
export default function StateChip({ state }: { state: PolicyState }) {
  const tone = TONE[state] ?? TONE.EXPIRED;
  return (
    <View style={[styles.chip, { backgroundColor: tone.bg }]}>
      <View style={[styles.dot, { backgroundColor: tone.fg }]} />
      <Text style={[styles.label, { color: tone.fg }]}>{POLICY_STATE_LABEL[state] ?? state}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: Radius.full,
    alignSelf: 'flex-start',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { ...Typography.labelSm, fontWeight: '700' as const },
});
