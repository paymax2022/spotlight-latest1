import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { INTAKE_STATUS_META } from '../constants/health.constants';
import type { IntakeStatus } from '../types';

/**
 * Pre-Consult intake status pill (M1) — mirrors the telemedicine
 * ConsultStatusBadge so the appointment card / detail surfaces read consistently.
 * `undefined` status = the patient hasn't started intake yet.
 */
export default function IntakeStatusBadge({ status }: { status?: IntakeStatus }) {
  const c = INTAKE_STATUS_META[status ?? 'NOT_STARTED'];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <View style={[styles.dot, { backgroundColor: c.fg }]} />
      <Text style={[styles.label, { color: c.fg }]}>{c.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingHorizontal: 10, borderRadius: Radius.full },
  dot: { width: 6, height: 6, borderRadius: Radius.full },
  label: { ...Typography.labelSm, fontWeight: '700' },
});
