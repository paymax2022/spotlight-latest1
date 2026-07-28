// ── Registration — application status chip ───────────────────────────────────

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import type { ApplicationStatus } from '../types/registration.types';
import { statusLabel, statusTone } from '../utils/status';

export default function StatusChip({ status }: { status: ApplicationStatus }) {
  const tone = statusTone(status);
  return (
    <View style={[styles.chip, { backgroundColor: tone.bg }]}>
      <Text style={[styles.text, { color: tone.fg }]}>{statusLabel(status)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full, alignSelf: 'flex-start' },
  text: { ...Typography.labelSm, fontWeight: '700' as const },
});
