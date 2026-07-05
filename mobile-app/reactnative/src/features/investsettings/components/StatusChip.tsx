import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { TICKET_STATUS_STYLE } from '../constants/settings.constants';
import type { TicketStatus } from '../types/settings.types';

interface Props {
  status: TicketStatus;
}

/**
 * Pill status chip for support-ticket statuses (mirrors CryptoStatusBadge).
 * Styling comes from TICKET_STATUS_STYLE (design tokens only).
 */
export default function StatusChip({ status }: Props) {
  const style = TICKET_STATUS_STYLE[status] ?? TICKET_STATUS_STYLE.open;
  return (
    <View style={[styles.pill, { backgroundColor: style.bg }]}>
      <View style={[styles.dot, { backgroundColor: style.fg }]} />
      <Text style={[styles.label, { color: style.fg }]}>{style.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  dot: { width: 6, height: 6, borderRadius: Radius.full },
  label: { ...Typography.labelSm, fontWeight: '600' as const },
});
