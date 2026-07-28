import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import type { ConsultStatus } from '@/types/telemedicine';

const CONFIG: Record<ConsultStatus, { label: string; fg: string; bg: string }> = {
  upcoming:    { label: 'Upcoming',    fg: Colors.secondary, bg: Colors.iconBgBlue },
  confirmed:   { label: 'Confirmed',   fg: '#16A34A',        bg: 'rgba(22,163,74,0.10)' },
  in_progress: { label: 'In Progress', fg: Colors.primary,   bg: Colors.iconBgPurple },
  completed:   { label: 'Completed',   fg: Colors.teal,      bg: Colors.iconBgTeal },
  cancelled:   { label: 'Cancelled',   fg: Colors.error,     bg: Colors.errorContainer },
};

export default function ConsultStatusBadge({ status }: { status: ConsultStatus }) {
  const c = CONFIG[status];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <View style={[styles.dot, { backgroundColor: c.fg }]} />
      <Text style={[styles.label, { color: c.fg }]}>{c.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingHorizontal: 10, borderRadius: Radius.full },
  dot:   { width: 6, height: 6, borderRadius: Radius.full },
  label: { ...Typography.labelSm, fontWeight: '700' },
});
